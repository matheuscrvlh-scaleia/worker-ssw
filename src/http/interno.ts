/**
 * HTTP interno (ERP → worker-ssw), só na rede interna do Docker. Contrato em
 * `../contrato-interno.ts` (ADR 0012 do ERP). A auditoria de quem pediu é do ERP, gravada antes de
 * chamar aqui.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { ErroDeNegocio } from "@erp/dominio/erros";
import { idDeExecucao } from "@erp/shared/ingestao";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { type FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import {
  consultaDaExecucao,
  DADOS_DOS_JOBS,
  execucaoCriada,
  type JobPedivel,
  parametrosDaEmpresa,
  parametrosDaExecucao,
  pedidoDeExecucao,
  PREFIXO_INTERNO,
  situacaoDaEmpresa,
  situacaoDaExecucao,
} from "../contrato-interno";
import { type Execucoes } from "../infra/execucoes";
import { type DefinicaoDeJob } from "../jobs/registro";

/** Chaves e números de evento por pedido de projeções: corpo maior que o padrão de 1 MiB. */
const LIMITE_DO_CORPO = 4 * 1024 * 1024;
/** O ERP consulta com espera (`aguardarMs`): limite folgado, por IP (o do contêiner da API). */
const LIMITE_POR_MINUTO = 1200;

const resumo = (texto: string) => createHash("sha256").update(texto).digest();

/** Confere o Bearer contra todos os aceitos, em tempo constante (sem parar no primeiro). */
export function tokenAceito(cabecalho: string | undefined, aceitos: readonly string[]): boolean {
  const recebido = cabecalho?.startsWith("Bearer ") ? cabecalho.slice(7).trim() : "";
  if (!recebido) return false;
  const a = resumo(recebido);
  let ok = false;
  for (const aceito of aceitos) ok = timingSafeEqual(a, resumo(aceito)) || ok;
  return ok;
}

/** Id de deduplicação do pedido: o mesmo do despachante (uma por job e empresa) ou por evento. */
export function idDeDeduplicacao(
  job: JobPedivel,
  empresaId: string,
  dados: Readonly<Record<string, unknown>>,
): string {
  if (job === "processar-webhook-ssw") return `ssw_webhook__${String(dados["eventoId"])}`;
  if (job === "projecoes-romaneio" || job === "projecoes-romaneio-completa") {
    return `${job}__${empresaId}`;
  }
  return idDeExecucao(job, empresaId);
}

const naoConfigurado = () =>
  new ErroDeNegocio("INDISPONIVEL", "HTTP interno do worker do SSW não configurado.");
const naoAutenticado = () =>
  new ErroDeNegocio("NAO_AUTENTICADO", "Token de serviço ausente ou inválido.");

export interface OpcoesDoInterno {
  /** Tokens de serviço aceitos (`INTERNO_TOKENS`). Vazio = HTTP interno desligado. */
  tokens: readonly string[];
  execucoes: Execucoes;
  /** Definições dos jobs registrados (o zod de cada um confere os dados de novo). */
  jobs: readonly DefinicaoDeJob[];
}

export const rotasInternas: FastifyPluginCallbackZod<OpcoesDoInterno> = (
  app,
  { tokens, execucoes, jobs },
  pronto,
) => {
  const porNome = new Map(jobs.map((j) => [j.nome, j]));

  // Autentica antes de ler o corpo.
  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    if (tokens.length === 0) throw naoConfigurado();
    if (!tokenAceito(request.headers.authorization, tokens)) throw naoAutenticado();
  });

  const config = { rateLimit: { max: LIMITE_POR_MINUTO, timeWindow: "1 minute" } };

  app.post(
    `${PREFIXO_INTERNO}/empresas/:empresaId/execucoes`,
    {
      bodyLimit: LIMITE_DO_CORPO,
      config,
      schema: {
        params: parametrosDaEmpresa,
        body: pedidoDeExecucao,
        response: { 202: execucaoCriada },
      },
    },
    async (request, reply) => {
      const { empresaId } = request.params;
      const { job, deduplicar } = request.body;
      const lidos = DADOS_DOS_JOBS[job].safeParse(request.body.dados ?? {});
      if (!lidos.success) {
        const [problema] = lidos.error.issues;
        const campo = problema?.path.join(".") ?? "";
        const motivo = problema?.message ?? "valor inválido";
        throw new ErroDeNegocio("ENTRADA_INVALIDA", `dados${campo ? `.${campo}` : ""}: ${motivo}`);
      }
      const dados: Record<string, unknown> = lidos.data;
      const definicao = porNome.get(job);
      if (!definicao?.dados.safeParse({ ...dados, empresaId }).success) {
        throw new ErroDeNegocio("ENTRADA_INVALIDA", `Dados inválidos para o job ${job}.`);
      }
      const r = await execucoes.pedir(
        empresaId,
        job,
        dados,
        deduplicar ? idDeDeduplicacao(job, empresaId, dados) : null,
      );
      if (!r.criada) {
        throw new ErroDeNegocio("CONFLITO", "Este job já está na fila desta empresa.");
      }
      return reply.status(202).send({ execucaoId: r.execucaoId });
    },
  );

  app.get(
    `${PREFIXO_INTERNO}/execucoes/:job/:execucaoId`,
    {
      config,
      schema: {
        params: parametrosDaExecucao,
        querystring: consultaDaExecucao,
        response: { 200: situacaoDaExecucao },
      },
    },
    async (request) => {
      const { job, execucaoId } = request.params;
      const situacao = await execucoes.consultar(job, execucaoId, request.query.aguardarMs);
      if (!situacao) throw new ErroDeNegocio("NAO_ENCONTRADO", "Execução não encontrada.");
      return situacao;
    },
  );

  app.get(
    `${PREFIXO_INTERNO}/empresas/:empresaId/situacao`,
    {
      config,
      schema: { params: parametrosDaEmpresa, response: { 200: situacaoDaEmpresa } },
    },
    (request) => execucoes.situacao(request.params.empresaId),
  );

  pronto();
};
