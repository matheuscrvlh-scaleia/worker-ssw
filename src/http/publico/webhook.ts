import { type ContextoBanco } from "@erp/db";
import { type ChavesDeSegredo, contextoDoSegredo, decifrarSegredo } from "@erp/db/secrets";
import { type FastifyPluginCallback, type FastifyRequest } from "fastify";

import {
  type AutenticacaoDoWebhook,
  autenticarWebhook,
  type CabecalhosDoWebhook,
  type EmpresaDoWebhook,
  type FilaDoWebhook,
  type PortasDoWebhook,
  processarWebhook,
} from "../../fontes/webhook/recepcao";
import { type RepositorioRecepcaoWebhook } from "../../fontes/webhook/repositorio-recepcao";
import { type ContadorPorJanela } from "../../infra/contador";
import { limitePorMinuto } from "../limite";

export const CAMINHO_DO_WEBHOOK = "/api/public/ssw-ocorrencias";

/** Cadastro de empresas e segredos do webhook guardado por 60 s (como hoje). */
const CACHE_MS = 60_000;
/** O SSW manda uma ocorrência por chamada e em rajada: limite próprio, bem acima do geral. */
const LIMITE_POR_MINUTO = 6_000;
/** Falhas de autenticação por IP por minuto; acima disso nada é gravado (resposta 429). */
export const LIMITE_DE_FALHAS_POR_MINUTO = 30;

/** Transação com contexto (RLS) e o repositório da recepção. */
export type ExecutorDaRecepcao = <T>(
  contexto: ContextoBanco,
  fn: (repositorio: RepositorioRecepcaoWebhook) => Promise<T>,
) => Promise<T>;

export interface OpcoesDoWebhookPublico {
  executar: ExecutorDaRecepcao;
  filas: FilaDoWebhook | null;
  chaves: ChavesDeSegredo | null;
  agora: () => Date;
  /** Falhas de autenticação por IP numa janela de 1 minuto. */
  falhas: ContadorPorJanela;
}

const PLATAFORMA = { empresaId: null, usuarioId: null, plataforma: true };
const daEmpresa = (empresaId: string) => ({ empresaId, usuarioId: null, plataforma: false });

function textoDe(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function cabecalhosDe(request: FastifyRequest): CabecalhosDoWebhook {
  const query = typeof request.query === "object" && request.query !== null ? request.query : {};
  return {
    authorization: request.headers.authorization ?? "",
    segredoNaQuery: textoDe(Reflect.get(query, "secret")),
    empresaNaQuery: textoDe(Reflect.get(query, "empresa")),
    // A borda é o Caddy: o IP vem do X-Forwarded-For só dos proxies confiáveis (`trustProxy`).
    ip: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

/**
 * Webhook SSW2181, no mesmo caminho de hoje. Sem sessão de usuário: autentica pelo segredo da
 * empresa (header `Authorization` ou `?secret=`), que nunca vai para o log (ver `http/log.ts`).
 * origem: src/routes/api/public/ssw-ocorrencias.ts (sistema atual)
 */
export const rotasPublicasSsw: FastifyPluginCallback<OpcoesDoWebhookPublico> = (
  app,
  opcoes,
  pronto,
) => {
  let cache: { ate: number; empresas: EmpresaDoWebhook[] } | null = null;
  const portas: PortasDoWebhook = {
    empresas: async () => {
      const agora = opcoes.agora().getTime();
      if (cache && cache.ate > agora) return cache.empresas;
      const empresas = await opcoes.executar(PLATAFORMA, (recepcao) =>
        recepcao.empresasComWebhook(),
      );
      cache = { ate: agora + CACHE_MS, empresas };
      return empresas;
    },
    segredo: (empresa) => {
      if (opcoes.chaves === null || empresa.segredo === null) return null;
      try {
        return decifrarSegredo(
          opcoes.chaves,
          empresa.segredo,
          contextoDoSegredo(empresa.id, "ssw_webhook"),
        );
      } catch {
        app.log.error(
          { empresaId: empresa.id },
          "segredo do webhook não decifra com as chaves atuais",
        );
        return null;
      }
    },
    registrarEvento: (evento) =>
      opcoes.executar(daEmpresa(evento.empresaId), (recepcao) => recepcao.registrarEvento(evento)),
    quarentenaDesde: (empresaId, desde) =>
      opcoes.executar(daEmpresa(empresaId), (recepcao) => recepcao.quarentenaDesde(desde)),
    falhaPermitida: async (ip) =>
      (await opcoes.falhas.somar(ip ?? "desconhecido")) <= LIMITE_DE_FALHAS_POR_MINUTO,
    marcarEvento: (empresaId, eventoId, status, erro) =>
      opcoes.executar(daEmpresa(empresaId), (recepcao) =>
        recepcao.marcarEvento(eventoId, status, erro),
      ),
    filas: opcoes.filas,
    agora: opcoes.agora,
    aleatorio: Math.random,
    avisar: (dados, mensagem) => {
      app.log.warn(dados, mensagem);
    },
  };

  // O corpo chega cru: JSON inválido também é registrado e respondido no formato do SSW.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", { parseAs: "string" }, (_request, corpo, feito) => {
    feito(null, corpo);
  });

  app.get(CAMINHO_DO_WEBHOOK, async (_request, reply) => {
    void reply.header("cache-control", "no-store");
    return {
      ok: true,
      endpoint: CAMINHO_DO_WEBHOOK,
      metodo: "POST",
      mensagem:
        "Webhook SSW2181 ativo. Envie o token no header Authorization ou em ?secret=<token> na URL.",
    };
  });

  // Autenticado no `onRequest`: a recusa sai antes de o corpo ser lido.
  const autenticacoes = new WeakMap<FastifyRequest, AutenticacaoDoWebhook>();
  app.post(
    CAMINHO_DO_WEBHOOK,
    {
      config: { rateLimit: false },
      onRequest: [
        limitePorMinuto(app, "ssw-ocorrencias", LIMITE_POR_MINUTO),
        async (request, reply) => {
          const autenticacao = await autenticarWebhook(portas, cabecalhosDe(request));
          if (autenticacao.tipo === "recusado") {
            const { status, corpo } = autenticacao.resposta;
            return reply.header("cache-control", "no-store").code(status).send(corpo);
          }
          autenticacoes.set(request, autenticacao);
        },
      ],
    },
    async (request, reply) => {
      const autenticacao = autenticacoes.get(request);
      if (!autenticacao || autenticacao.tipo === "recusado") {
        throw new Error("webhook sem autenticação decidida no onRequest");
      }
      const resposta = await processarWebhook(
        portas,
        {
          ...cabecalhosDe(request),
          corpoBruto: typeof request.body === "string" ? request.body : "",
        },
        autenticacao,
      );
      void reply.header("cache-control", "no-store").code(resposta.status);
      return resposta.corpo;
    },
  );

  pronto();
};
