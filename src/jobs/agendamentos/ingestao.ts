/**
 * Agendador da ingestão por empresa (antes `ingestao_despachar` + pg_cron + pg_net). Cada horário
 * do catálogo (`@erp/shared/ingestion`) vira um agendamento do BullMQ que dispara o despachante; o
 * despachante enfileira uma execução por empresa ativa com a integração ligada (os jobs BI2 em
 * rodízio), sem repetir execução que já está na fila. Especificação: docs/regras/06-ingestao.md §4.
 */
import {
  filaDoJob,
  idDeExecucao,
  type IntegracaoDaIngestao,
  integracoesDoJob,
  type JobDeIngestao,
  JOBS_DE_INGESTAO,
  type NomeDoJobDeIngestao,
} from "@erp/shared/ingestion";
import { z } from "@erp/shared/zod";

import { definirJob } from "../registro";
import { type Agendamento } from "./agendamentos";

export const JOB_DESPACHANTE = "despachar_ingestao";

const NOMES = JOBS_DE_INGESTAO.map((j) => j.job);

/** Enfileira um job de ingestão (a API usa o mesmo formato no disparo manual). */
export interface Enfileirador {
  enfileirar(
    job: NomeDoJobDeIngestao,
    dados: Readonly<Record<string, unknown>>,
    opcoes: { deduplicar: string | null },
  ): Promise<void>;
}

export interface RepositorioDoDespachante {
  /**
   * Empresas ativas ou em implantação com qualquer uma das integrações ligada, na ordem de criação.
   */
  empresasComIntegracao(tipos: readonly IntegracaoDaIngestao[]): Promise<{ id: string }[]>;
}

/**
 * Um agendamento (no fila `agendador`, em UTC) por job do catálogo que tem horário, está ligado
 * no ambiente (`INGESTAO_JOBS_LIGADOS`) e tem handler registrado neste worker.
 */
export function agendamentosDeIngestao(
  ligados: readonly string[],
  registrados: ReadonlySet<string>,
): Agendamento[] {
  return JOBS_DE_INGESTAO.flatMap((j: JobDeIngestao) =>
    j.cron !== null && ligados.includes(j.job) && registrados.has(j.job)
      ? [
          {
            id: `ingestao:${j.job}`,
            job: JOB_DESPACHANTE,
            padrao: j.cron,
            fuso: "UTC",
            dados: { job: j.job },
          },
        ]
      : [],
  );
}

/** Rodízio: só a empresa da posição `floor(minutos desde 1970) % total`. */
export function empresasDoDisparo<E>(job: JobDeIngestao, empresas: readonly E[], agora: Date): E[] {
  if (!job.rodizio || empresas.length === 0) return [...empresas];
  const posicao = Math.floor(agora.getTime() / 60_000) % empresas.length;
  const escolhida = empresas[posicao];
  return escolhida === undefined ? [] : [escolhida];
}

export function criarDespachante(enfileirador: Enfileirador) {
  return definirJob({
    nome: JOB_DESPACHANTE,
    fila: "agendador",
    escopo: "plataforma",
    dados: z.object({ job: z.enum(NOMES) }),
    agendamento: null,
    async processar({ executar, agora, log }, { job }) {
      const definicao = JOBS_DE_INGESTAO.find((j) => j.job === job);
      if (definicao === undefined) return { enfileirados: 0 };
      const empresas = await executar(({ agendamentos }) =>
        agendamentos.empresasComIntegracao(integracoesDoJob(definicao)),
      );
      const alvo = empresasDoDisparo(definicao, empresas, agora());
      for (const { id } of alvo) {
        await enfileirador.enfileirar(
          job,
          { ...definicao.dados, empresaId: id },
          { deduplicar: idDeExecucao(job, id) },
        );
      }
      log.debug({ job, fila: filaDoJob(job), empresas: alvo.length }, "ingestão despachada");
      return { enfileirados: alvo.length };
    },
  });
}
