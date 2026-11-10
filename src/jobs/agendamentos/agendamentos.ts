import { type DefinicaoDeJob } from "../registro";
import { type RepositorioDoDespachante } from "./ingestao";

export interface EmpresaAgendavel {
  id: string;
  fuso: string;
}

export interface RepositorioAgendamentos extends RepositorioDoDespachante {
  /** Empresas que recebem agendamento por empresa (ativas ou em implantação). */
  empresasAtivas(): Promise<EmpresaAgendavel[]>;
}

/** O pedaço da fila do BullMQ que os agendamentos usam (os testes passam um falso). */
export interface FilaAgendavel {
  getJobSchedulers(): Promise<{ key: string }[]>;
  upsertJobScheduler(
    id: string,
    repeticao: { pattern: string; tz: string },
    modelo: { name: string; data: Record<string, unknown> },
  ): Promise<unknown>;
  removeJobScheduler(id: string): Promise<boolean>;
}

export interface Agendamento {
  id: string;
  job: string;
  padrao: string;
  fuso: string;
  dados: Record<string, unknown>;
}

const FUSO_DA_PLATAFORMA = "America/Sao_Paulo";

/** Agendamentos desejados: um por job da Plataforma e um por empresa nos jobs por empresa. */
export function agendamentosDesejados(
  jobs: readonly DefinicaoDeJob[],
  empresas: readonly EmpresaAgendavel[],
): Agendamento[] {
  return jobs.flatMap((job) => {
    const padrao = job.agendamento;
    if (!padrao) return [];
    if (job.escopo === "plataforma") {
      return [{ id: job.nome, job: job.nome, padrao, fuso: FUSO_DA_PLATAFORMA, dados: {} }];
    }
    return empresas.map((e) => ({
      id: `${job.nome}:${e.id}`,
      job: job.nome,
      padrao,
      fuso: e.fuso,
      dados: { empresaId: e.id },
    }));
  });
}

/**
 * Deixa a fila com exatamente os agendamentos desejados: cria/atualiza os que faltam e remove os
 * que sobraram (empresa desativada, job removido ou agendamentos desligados por env).
 */
export async function sincronizarAgendamentos(
  fila: FilaAgendavel,
  desejados: readonly Agendamento[],
): Promise<{ criados: number; removidos: number }> {
  const ids = new Set(desejados.map((a) => a.id));
  const existentes = await fila.getJobSchedulers();
  const sobrando = existentes.filter((e) => !ids.has(e.key));
  for (const { key } of sobrando) await fila.removeJobScheduler(key);
  for (const a of desejados) {
    await fila.upsertJobScheduler(
      a.id,
      { pattern: a.padrao, tz: a.fuso },
      { name: a.job, data: a.dados },
    );
  }
  return { criados: desejados.length, removidos: sobrando.length };
}
