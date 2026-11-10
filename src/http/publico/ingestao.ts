/**
 * Rotas públicas da ingestão SSW, nos mesmos caminhos de hoje (spec 06 §6). Sem sessão: segredo
 * por cabeçalho comparado em tempo constante; nunca a chave publicável. O segredo é da empresa
 * (integração `ingestao_publica`, cifrado) e é ele que diz qual empresa chama (ADR 0010). Q46 b: as rotas 410
 * (`ftp-xml-import`, `ssw-ingest`, `enriquecer-*`) não são recriadas; `xml-recuperar-orfaos` é
 * código morto (§9).
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { filaDoJob, idDeExecucao } from "@erp/shared/ingestao";
import { z } from "@erp/shared/zod";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { type FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import {
  decidirEmpresa,
  LIMITE_PADRAO_DOS_ORFAOS,
  receberArquivo,
  reprocessarOrfaos,
  sha256,
  type TipoIntegracao,
} from "../../aplicacao/casos-de-uso";
import { limitePorMinuto } from "../limite";
import { type SegredoDaIngestao, type ServicosDaIngestao } from "./servicos";

/** Arquivos em base64 (455 CSV chega dividido, mas a parte retroativa pode vir inteira). */
const LIMITE_COM_ARQUIVO = 64 * 1024 * 1024;
const LIMITE_SEM_ARQUIVO = 1024 * 1024;

/** Compara em tempo constante (resumo de tamanho fixo: não vaza o tamanho do segredo). */
export function segredoConfere(recebido: string | undefined, esperado: string | null): boolean {
  if (!recebido || !esperado) return false;
  const a = createHash("sha256").update(recebido).digest();
  const b = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(a, b);
}

const cabecalho = (request: FastifyRequest, nome: string) => {
  const v = request.headers[nome];
  return Array.isArray(v) ? v[0] : v;
};

const corpoComEmpresa = z
  .object({ empresa: z.string().optional(), empresa_id: z.string().optional() })
  .loose();

function empresaPedida(
  request: FastifyRequest,
  corpo: { empresa?: string | undefined; empresa_id?: string | undefined },
) {
  const query = request.query as Record<string, unknown> | undefined;
  const daQuery = typeof query?.empresa === "string" ? query.empresa : undefined;
  return (
    [daQuery, cabecalho(request, "x-empresa"), corpo.empresa, corpo.empresa_id].find(
      (v) => v !== undefined && v.trim() !== "",
    ) ?? null
  );
}

const erro = (reply: FastifyReply, status: number, motivo: string, mensagem: string) =>
  reply.status(status).send({ ok: false, motivo, erro: mensagem });

/** Segredos decifrados guardados por 60 s (como o cadastro do webhook). */
const CACHE_MS = 60_000;

export const rotasPublicasDaIngestao: FastifyPluginCallbackZod<{
  servicos: ServicosDaIngestao;
  agora: () => Date;
}> = (app, { servicos, agora }, pronto) => {
  let cache: { ate: number; segredos: SegredoDaIngestao[] } | null = null;
  async function segredos() {
    const instante = agora().getTime();
    if (cache && cache.ate > instante) return cache.segredos;
    cache = { ate: instante + CACHE_MS, segredos: await servicos.segredosDaIngestao() };
    return cache.segredos;
  }
  /** Empresa dona do segredo recebido em cada chamada autenticada. */
  const empresaDoSegredo = new WeakMap<FastifyRequest, string>();

  /**
   * `onRequest`: confere o segredo antes de o corpo (até 64 MB) ser lido e validado. Sem segredo
   * válido a resposta sai aqui e o handler nunca roda.
   */
  const autenticar =
    (aceitaCron: boolean) => async (request: FastifyRequest, reply: FastifyReply) => {
      if (!(await autorizado(request, reply, aceitaCron))) return reply;
    };

  /**
   * Acha a empresa pelo segredo (`x-ftp-ingest-secret` ou, nas rotas de cron, `x-cron-token`);
   * devolve `false` se já respondeu o erro.
   */
  async function autorizado(request: FastifyRequest, reply: FastifyReply, aceitaCron: boolean) {
    const recebidos = [
      cabecalho(request, "x-ftp-ingest-secret"),
      aceitaCron ? cabecalho(request, "x-cron-token") : undefined,
    ];
    const cadastrados = await segredos();
    const dona = cadastrados.find((c) => recebidos.some((r) => segredoConfere(r, c.segredo)));
    if (dona) {
      empresaDoSegredo.set(request, dona.empresaId);
      return true;
    }
    if (cadastrados.length === 0) {
      await erro(
        reply,
        503,
        "ingest_secret_nao_configurado",
        "Segredo das rotas públicas não cadastrado: Plataforma → Empresa → Integrações.",
      );
    } else {
      await erro(reply, 401, "token_invalido", "Segredo ausente ou inválido.");
    }
    return false;
  }

  async function empresaDe(
    request: FastifyRequest,
    reply: FastifyReply,
    tipo: TipoIntegracao,
    corpo: z.infer<typeof corpoComEmpresa>,
  ) {
    // Só a empresa dona do segredo: pedir outra (`?empresa=`, `x-empresa`, corpo) dá 404.
    const dona = empresaDoSegredo.get(request);
    const empresas = (await servicos.empresasParaIngestao()).filter((e) => e.id === dona);
    const d = decidirEmpresa(empresaPedida(request, corpo), tipo, empresas);
    if (!d.ok) {
      await erro(reply, d.status, d.motivo, d.erro);
      return null;
    }
    return d.empresa.id;
  }

  app.post(
    "/api/public/ftp-relatorio-import",
    {
      bodyLimit: LIMITE_COM_ARQUIVO,
      // Limite próprio na frente da autenticação (o global fica desligado nesta rota).
      config: { rateLimit: false },
      onRequest: [limitePorMinuto(app, "ftp-relatorio-import", 240), autenticar(false)],
      schema: {
        body: corpoComEmpresa.extend({
          nome: z.string().optional(),
          base64: z.string().optional(),
          sha256: z.string().optional(),
          tamanho: z.number().optional(),
          mtime: z.number().optional(),
        }),
      },
    },
    async (request, reply) => {
      const corpo = request.body;
      if (!corpo.nome || !corpo.base64) {
        return erro(reply, 400, "nome_ou_base64_ausentes", "Informe nome e base64 do arquivo.");
      }
      const texto = corpo.base64.includes(",")
        ? (corpo.base64.split(",", 2)[1] ?? "")
        : corpo.base64;
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(texto.replace(/\s/g, ""))) {
        return erro(reply, 400, "base64_invalido", "Conteúdo base64 inválido.");
      }
      const empresaId = await empresaDe(request, reply, "sftp", corpo);
      if (!empresaId) return reply;
      const bytes = new Uint8Array(Buffer.from(texto, "base64"));
      try {
        return await receberArquivo(
          {
            empresaId,
            executar: servicos.executarNaEmpresa(empresaId),
            enfileirador: servicos.enfileirador,
          },
          {
            nome: corpo.nome,
            bytes,
            sha256: corpo.sha256 ?? sha256(bytes),
            tamanho: corpo.tamanho ?? bytes.length,
            mtime: corpo.mtime ?? 0,
          },
        );
      } catch (e) {
        request.log.error({ err: e }, "ftp-relatorio-import");
        return erro(
          reply,
          500,
          "excecao_no_pipeline",
          "Falha ao processar o arquivo. Tente de novo; se persistir, avise o suporte.",
        );
      }
    },
  );

  app.post(
    "/api/public/ssw-ciclo-aplicar",
    {
      bodyLimit: LIMITE_SEM_ARQUIVO,
      config: { rateLimit: false },
      onRequest: [limitePorMinuto(app, "ssw-ciclo-aplicar", 120), autenticar(true)],
      schema: { body: corpoComEmpresa.optional() },
    },
    async (request, reply) => {
      const empresaId = await empresaDe(request, reply, "sftp", request.body ?? {});
      if (!empresaId) return reply;
      // O ciclo roda no worker (singleton por empresa); a rota só pede a rodada.
      await servicos.enfileirador.enfileirar(
        filaDoJob("aplicar-ciclos"),
        "aplicar-ciclos",
        { empresaId },
        { deduplicacao: idDeExecucao("aplicar-ciclos", empresaId) },
      );
      return { ok: true, status: "enfileirado", resultados: [] };
    },
  );

  app.post(
    "/api/public/xml-orfaos-retry",
    {
      bodyLimit: LIMITE_SEM_ARQUIVO,
      config: { rateLimit: false },
      onRequest: [limitePorMinuto(app, "xml-orfaos-retry", 30), autenticar(true)],
      schema: {
        body: corpoComEmpresa
          .extend({ limite: z.number().int().min(1).max(1000).optional() })
          .optional(),
      },
    },
    async (request, reply) => {
      const corpo = request.body ?? {};
      const empresaId = await empresaDe(request, reply, "xml_cte", corpo);
      if (!empresaId) return reply;
      const r = await reprocessarOrfaos(
        servicos.executarNaEmpresa(empresaId),
        corpo.limite ?? LIMITE_PADRAO_DOS_ORFAOS,
        agora(),
      );
      return { ok: true, ...r };
    },
  );

  pronto();
};
