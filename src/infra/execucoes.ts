/**
 * Execuções pedidas pelo ERP (HTTP interno) sobre as filas do BullMQ: criar, consultar e a
 * situação dos jobs de uma empresa. O ERP não enxerga este Redis; só fala com estas três funções.
 */
import { randomUUID } from "node:crypto";

import {
  type EstadoDaExecucao,
  type JobPedivel,
  JOBS_PEDIVEIS,
  type SituacaoDaEmpresa,
  type SituacaoDaExecucao,
} from "../contrato-interno";

/** O pedaço de um job do BullMQ que se lê aqui (os testes passam falsos). */
export interface JobDaFila {
  id?: string | undefined;
  name: string;
  data: unknown;
  finishedOn?: number | undefined;
  failedReason: string;
  returnvalue: unknown;
  getState(): Promise<string>;
}

/** O pedaço da `Queue` do BullMQ usado aqui. */
export interface FilaConsultavel {
  add(
    nome: string,
    dados: Record<string, unknown>,
    opcoes: { jobId: string; deduplication?: { id: string } },
  ): Promise<{ id?: string | undefined }>;
  getJob(id: string): Promise<JobDaFila | undefined>;
  getJobs(tipos: string[], inicio: number, fim: number): Promise<JobDaFila[]>;
  getJobScheduler(id: string): Promise<{ next?: number | undefined } | undefined>;
}

export type ResultadoDoPedido = { criada: true; execucaoId: string } | { criada: false };

export interface Execucoes {
  pedir(
    empresaId: string,
    job: JobPedivel,
    dados: Record<string, unknown>,
    deduplicar: string | null,
  ): Promise<ResultadoDoPedido>;
  /** `null` se a execução não existe (ou é de outro job). */
  consultar(
    job: JobPedivel,
    execucaoId: string,
    aguardarMs: number,
  ): Promise<SituacaoDaExecucao | null>;
  situacao(empresaId: string): Promise<SituacaoDaEmpresa>;
}

export interface DependenciasDasExecucoes {
  /** Fila de cada job (a mesma do registro dos jobs). */
  filaDoJob(job: JobPedivel): FilaConsultavel;
  agendador: FilaConsultavel;
  tokenSswGeradoEm(empresaId: string): Promise<Date | null>;
  esperar(ms: number): Promise<void>;
  gerarId?: () => string;
}

const INTERVALO_DA_ESPERA_MS = 500;
/** Quantos jobs recentes olhar para achar os da empresa (o histórico é de todas). */
const JANELA_DO_HISTORICO = 50;
const NA_FILA = ["waiting", "prioritized", "delayed", "waiting-children"];

export function estadoDoBullmq(estado: string): EstadoDaExecucao {
  if (estado === "completed") return "concluida";
  if (estado === "failed") return "falhou";
  if (estado === "active") return "rodando";
  return "na_fila";
}

function empresaDo(job: JobDaFila): string | null {
  const dados = job.data;
  if (typeof dados !== "object" || dados === null) return null;
  const empresaId: unknown = Reflect.get(dados, "empresaId");
  return typeof empresaId === "string" ? empresaId : null;
}

export function criarExecucoes(deps: DependenciasDasExecucoes): Execucoes {
  const gerarId = deps.gerarId ?? randomUUID;

  async function retrato(job: JobDaFila): Promise<SituacaoDaExecucao> {
    const estado = estadoDoBullmq(await job.getState());
    if (estado === "concluida") return { estado, resultado: job.returnvalue };
    if (estado === "falhou") return { estado, erro: job.failedReason };
    return { estado };
  }

  async function situacaoDoJob(empresaId: string, nome: JobPedivel) {
    const fila = deps.filaDoJob(nome);
    const daEmpresa = (j: JobDaFila) => j.name === nome && empresaDo(j) === empresaId;
    const [ativos, esperando, concluidos, falhos, porEmpresa, global] = await Promise.all([
      fila.getJobs(["active"], 0, JANELA_DO_HISTORICO - 1),
      fila.getJobs(NA_FILA, 0, JANELA_DO_HISTORICO - 1),
      fila.getJobs(["completed"], 0, JANELA_DO_HISTORICO - 1),
      fila.getJobs(["failed"], 0, JANELA_DO_HISTORICO - 1),
      fila.getJobScheduler(`${nome}:${empresaId}`),
      deps.agendador.getJobScheduler(`ingestao:${nome}`),
    ]);
    const terminados = [
      ...concluidos.filter(daEmpresa).map((j) => ({ j, estado: "concluida" as const })),
      ...falhos.filter(daEmpresa).map((j) => ({ j, estado: "falhou" as const })),
    ].sort((a, b) => (b.j.finishedOn ?? 0) - (a.j.finishedOn ?? 0));
    const ultimo = terminados[0];
    const ultimaExecucao =
      ultimo?.j.id !== undefined && ultimo.j.finishedOn !== undefined
        ? {
            execucaoId: ultimo.j.id,
            estado: ultimo.estado,
            terminadaEm: new Date(ultimo.j.finishedOn).toISOString(),
            ...(ultimo.estado === "falhou" ? { erro: ultimo.j.failedReason } : {}),
          }
        : undefined;
    const estado = ativos.some(daEmpresa)
      ? ("rodando" as const)
      : esperando.some(daEmpresa)
        ? ("na_fila" as const)
        : (ultimaExecucao?.estado ?? ("sem_execucao" as const));
    const proxima = porEmpresa?.next ?? global?.next;
    return {
      job: nome,
      estado,
      ...(ultimaExecucao ? { ultimaExecucao } : {}),
      ...(proxima !== undefined ? { proximaExecucao: new Date(proxima).toISOString() } : {}),
    };
  }

  return {
    async pedir(empresaId, job, dados, deduplicar) {
      const execucaoId = gerarId();
      const criado = await deps
        .filaDoJob(job)
        .add(
          job,
          { ...dados, empresaId },
          { jobId: execucaoId, ...(deduplicar ? { deduplication: { id: deduplicar } } : {}) },
        );
      // Deduplicado, o BullMQ devolve o id do job que já estava na fila.
      return criado.id === execucaoId ? { criada: true, execucaoId } : { criada: false };
    },

    async consultar(job, execucaoId, aguardarMs) {
      const fila = deps.filaDoJob(job);
      for (let gasto = 0; ; gasto += INTERVALO_DA_ESPERA_MS) {
        const atual = await fila.getJob(execucaoId);
        if (!atual || atual.name !== job) return null;
        const situacao = await retrato(atual);
        const terminou = situacao.estado === "concluida" || situacao.estado === "falhou";
        if (terminou || gasto + INTERVALO_DA_ESPERA_MS > aguardarMs) return situacao;
        await deps.esperar(INTERVALO_DA_ESPERA_MS);
      }
    },

    async situacao(empresaId) {
      const [jobs, token] = await Promise.all([
        Promise.all(JOBS_PEDIVEIS.map((j) => situacaoDoJob(empresaId, j))),
        deps.tokenSswGeradoEm(empresaId),
      ]);
      return { jobs, ...(token ? { tokenSswGeradoEm: token.toISOString() } : {}) };
    },
  };
}
