import { type ContextoBanco } from "@erp/db";
import { type RepositorioProjecoesRomaneio } from "@erp/domain/manifest/projections";
import { type RepositorioGravacao050 } from "@erp/domain/pickups/write-050";
import { filaDoJob, JOBS_DE_INGESTAO, type NomeDoJobDeIngestao } from "@erp/shared/ingestion";
import { type z } from "@erp/shared/zod";
import { type Logger } from "pino";

import {
  type RepositorioCteNucleo,
  type RepositorioDeRetencao,
  type RepositorioIngestao,
} from "../aplicacao/casos-de-uso";
import { type RepositorioBi2 } from "../fontes/bi2/job";
import { type RepositorioIntegracoes } from "../fontes/comum/integracao";
import { type RepositorioWebhook } from "../fontes/webhook/job";
import { type RepositorioAgendamentos } from "./agendamentos/agendamentos";
import { type RepositorioManutencao } from "./manutencao/job";
import { type RepositorioSlaArquivos } from "./sla-arquivos/job";

/** Repositórios dos jobs presos a uma transação com contexto (mesmo padrão da API do ERP). */
export interface RepositoriosDoWorker {
  agendamentos: RepositorioAgendamentos;
  manutencao: RepositorioManutencao;
  integracoes: RepositorioIntegracoes;
  cteNucleo: RepositorioCteNucleo;
  bi2: RepositorioBi2;
  webhook: RepositorioWebhook;
  /** Ingestão SSW por arquivo da empresa do contexto (ator: sistema). */
  ingestao: (empresaId: string) => RepositorioIngestao;
  retencaoDaIngestao: RepositorioDeRetencao;
  slaArquivos: RepositorioSlaArquivos;
  projecoesRomaneio: RepositorioProjecoesRomaneio;
  /** Gravação do 050 de coletas (o mesmo da tela). */
  coletas050: RepositorioGravacao050;
}

export type ExecutorDoWorker = <T>(
  contexto: ContextoBanco,
  fn: (repositorios: RepositoriosDoWorker) => Promise<T>,
) => Promise<T>;

export type NomeDaFila =
  "manutencao" | "agendador" | "projecoes" | "coletas" | ReturnType<typeof filaDoJob>;

export interface DefinicaoDeFila {
  nome: NomeDaFila;
  /** Jobs ao mesmo tempo neste processo. */
  concorrencia: number;
  /** Jobs ao mesmo tempo em todos os processos do worker (`setGlobalConcurrency`). */
  concorrenciaGlobal?: number;
}

/**
 * Uma execução por vez em todos os processos: o BI2 é pesado e o SSW limita (era a lease
 * `bi2_pesado`); o webhook em ordem para duas ocorrências do mesmo CT-e não se cruzarem.
 */
const UMA_POR_VEZ: ReadonlySet<NomeDoJobDeIngestao> = new Set([
  "bi2-0017",
  "processar-webhook-ssw",
]);

/**
 * Filas e a concorrência de cada uma. Fila separada por natureza de trabalho: ingestão pesada não
 * pode atrasar manutenção, e vice-versa. Cada job de ingestão tem a sua (singleton por empresa).
 */
export const FILAS: readonly DefinicaoDeFila[] = [
  // Retenção da ingestão SSW/BI2 (limpar-ingestao-ssw).
  { nome: "manutencao", concorrencia: 1 },
  { nome: "agendador", concorrencia: 1 },
  // Recalcular projeções do Romaneio é leve e por lote de CT-e: dois ao mesmo tempo.
  { nome: "projecoes", concorrencia: 2 },
  // 050 de coletas do FTP: um por vez (o mais novo vence pela emissão, a ordem não importa).
  { nome: "coletas", concorrencia: 1 },
  ...JOBS_DE_INGESTAO.map(({ job }) => ({
    nome: filaDoJob(job),
    concorrencia: 1,
    ...(UMA_POR_VEZ.has(job) ? { concorrenciaGlobal: 1 } : {}),
  })),
];

/** `plataforma`: um job para o sistema todo. `empresa`: um por empresa ativa, no contexto dela. */
export type Escopo = "plataforma" | "empresa";

export interface ContextoDoJob {
  /** Já no contexto do job: empresa (escopo empresa) ou Plataforma (escopo plataforma). */
  executar: <T>(fn: (repositorios: RepositoriosDoWorker) => Promise<T>) => Promise<T>;
  empresaId: string | null;
  log: Logger;
  agora: () => Date;
}

export interface DefinicaoDeJob<D = unknown> {
  nome: string;
  fila: NomeDaFila;
  escopo: Escopo;
  dados: z.ZodType<D>;
  /** Cron (no fuso da empresa; Plataforma em America/Sao_Paulo). Nulo = só sob demanda. */
  agendamento: string | null;
  // Assinatura de método (não propriedade) de propósito: deixa a lista de jobs com dados
  // diferentes caber em DefinicaoDeJob[]; quem garante o tipo em tempo de execução é o zod.
  // O que devolve vira o resultado do job no BullMQ (o ERP lê pelo HTTP interno).
  processar(contexto: ContextoDoJob, dados: D): Promise<unknown>;
}

export function definirJob<D>(definicao: DefinicaoDeJob<D>): DefinicaoDeJob<D> {
  return definicao;
}

export { OPCOES_PADRAO_DO_JOB } from "@erp/shared/ingestion";
