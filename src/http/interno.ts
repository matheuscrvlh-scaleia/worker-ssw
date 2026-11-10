/**
 * HTTP interno (ERP → worker-ssw), só na rede interna do Docker. Contrato em
 * `../contrato-interno.ts` (ADR 0012 do ERP): pedidos de job e as operações manuais da tela
 * Admin › Importação SSW. A auditoria de quem pediu é do ERP, gravada antes de chamar aqui.
 */
import { createHash, timingSafeEqual } from "node:crypto";

import { ErroDeNegocio } from "@erp/dominio/erros";
import { idDeExecucao } from "@erp/shared/ingestao";
import { type FastifyReply, type FastifyRequest } from "fastify";
import { type FastifyPluginCallbackZod } from "fastify-type-provider-zod";

import { type OperacoesManuais } from "../aplicacao/casos-de-uso";
import {
  cicloDescartado,
  cicloRetomado,
  consultaDaExecucao,
  DADOS_DOS_JOBS,
  execucaoCriada,
  type JobPedivel,
  LIMITE_DO_ARQUIVO_EM_BASE64,
  ok,
  parametrosDaEmpresa,
  parametrosDaExecucao,
  parametrosDoCiclo,
  pedidoDeAplicacao,
  pedidoDeDescarte,
  pedidoDeExecucao,
  pedidoDeFtpAtivo,
  pedidoDeRelatorio,
  pedidoDeXml,
  PREFIXO_INTERNO,
  relatorioImportado,
  resultadoDaAplicacao,
  resultadoDoXml,
  situacaoDaEmpresa,
  situacaoDaExecucao,
  situacaoDoFtp,
} from "../contrato-interno";
import { type Execucoes } from "../infra/execucoes";
import { type DefinicaoDeJob } from "../jobs/registro";
import { limitePorMinuto } from "./limite";

/** Chaves e números de evento por pedido de projeções: corpo maior que o padrão de 1 MiB. */
const LIMITE_DO_CORPO = 4 * 1024 * 1024;
/** Relatório ou XML/zip enviado à mão (até 64 MB decodificado), só nessas duas rotas. */
const LIMITE_DO_CORPO_COM_ARQUIVO = LIMITE_DO_ARQUIVO_EM_BASE64 + 64 * 1024;
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
  /** Operações manuais da tela Admin › Importação SSW. */
  manuais: OperacoesManuais;
}

export const rotasInternas: FastifyPluginCallbackZod<OpcoesDoInterno> = (
  app,
  { tokens, execucoes, jobs, manuais },
  pronto,
) => {
  const porNome = new Map(jobs.map((j) => [j.nome, j]));

  // Limite na frente da autenticação (conta também o token errado); depois autentica, antes de
  // ler o corpo.
  app.addHook("onRequest", limitePorMinuto(app, "interno", LIMITE_POR_MINUTO));
  app.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
    if (tokens.length === 0) throw naoConfigurado();
    if (!tokenAceito(request.headers.authorization, tokens)) throw naoAutenticado();
  });

  const config = { rateLimit: false } as const;

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

  // --- Operações manuais (Admin › Importação SSW) ---------------------------------------------
  const daEmpresa = `${PREFIXO_INTERNO}/empresas/:empresaId`;

  app.post(
    `${daEmpresa}/ciclos/:chave/retomar`,
    { config, schema: { params: parametrosDoCiclo, response: { 200: cicloRetomado } } },
    (request) => manuais.retomarCiclo(request.params.empresaId, request.params.chave),
  );

  app.post(
    `${daEmpresa}/ciclos/:chave/descartar`,
    {
      config,
      schema: {
        params: parametrosDoCiclo,
        // Sem corpo (o motivo é opcional) chega como null.
        body: pedidoDeDescarte.nullish(),
        response: { 200: cicloDescartado },
      },
    },
    (request) =>
      manuais.descartarCiclo(request.params.empresaId, request.params.chave, request.body?.motivo),
  );

  app.post(
    `${daEmpresa}/relatorios`,
    {
      bodyLimit: LIMITE_DO_CORPO_COM_ARQUIVO,
      config,
      schema: {
        params: parametrosDaEmpresa,
        body: pedidoDeRelatorio,
        response: { 200: relatorioImportado },
      },
    },
    (request) => manuais.importarRelatorio(request.params.empresaId, request.body),
  );

  app.post(
    `${daEmpresa}/aplicacoes`,
    {
      config,
      schema: {
        params: parametrosDaEmpresa,
        body: pedidoDeAplicacao,
        response: { 200: resultadoDaAplicacao },
      },
    },
    (request) => manuais.aplicar(request.params.empresaId, request.body),
  );

  app.get(
    `${daEmpresa}/ftp`,
    { config, schema: { params: parametrosDaEmpresa, response: { 200: situacaoDoFtp } } },
    (request) => manuais.lerFtp(request.params.empresaId),
  );

  app.put(
    `${daEmpresa}/ftp/ativo`,
    {
      config,
      schema: { params: parametrosDaEmpresa, body: pedidoDeFtpAtivo, response: { 200: ok } },
    },
    async (request) => {
      await manuais.ativarFtp(request.params.empresaId, request.body.ativo);
      return { ok: true as const };
    },
  );

  app.post(
    `${daEmpresa}/ftp/liberar-trava`,
    { config, schema: { params: parametrosDaEmpresa, response: { 200: ok } } },
    async (request) => {
      await manuais.liberarTravaDoFtp(request.params.empresaId);
      return { ok: true as const };
    },
  );

  app.post(
    `${daEmpresa}/xml`,
    {
      bodyLimit: LIMITE_DO_CORPO_COM_ARQUIVO,
      config,
      schema: { params: parametrosDaEmpresa, body: pedidoDeXml, response: { 200: resultadoDoXml } },
    },
    (request) => manuais.importarXml(request.params.empresaId, request.body),
  );

  pronto();
};
