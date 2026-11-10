import { describe, expect, it } from "vitest";

import { situacaoDaEmpresa } from "../contrato-interno";
import { criarExecucoes, estadoDoBullmq, type FilaConsultavel, type JobDaFila } from "./execucoes";

const A = "0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d";
const B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

function job(
  id: string,
  name: string,
  estado: string,
  extra: Partial<JobDaFila> & { empresaId?: string } = {},
): JobDaFila & { estado: string } {
  let atual = estado;
  return {
    id,
    name,
    data: { empresaId: extra.empresaId ?? A },
    failedReason: extra.failedReason ?? "",
    attemptsMade: extra.attemptsMade ?? 1,
    returnvalue: extra.returnvalue ?? null,
    finishedOn: extra.finishedOn,
    get estado() {
      return atual;
    },
    set estado(e: string) {
      atual = e;
    },
    getState: () => Promise.resolve(atual),
  };
}

class FilaFalsa implements FilaConsultavel {
  jobs: (JobDaFila & { estado: string })[] = [];
  agendamentos = new Map<string, number>();
  add(
    nome: string,
    dados: Record<string, unknown>,
    opcoes: { jobId: string; deduplication?: { id: string } },
  ) {
    const igual = opcoes.deduplication
      ? this.jobs.find(
          (j) =>
            j.estado !== "completed" &&
            j.estado !== "failed" &&
            `dedup:${opcoes.deduplication?.id ?? ""}` === Reflect.get(j, "dedup"),
        )
      : undefined;
    if (igual) return Promise.resolve({ id: igual.id });
    const novo = Object.assign(job(opcoes.jobId, nome, "waiting"), {
      data: dados,
      dedup: `dedup:${opcoes.deduplication?.id ?? ""}`,
    });
    this.jobs.push(novo);
    return Promise.resolve({ id: opcoes.jobId });
  }
  getJob(id: string) {
    return Promise.resolve(this.jobs.find((j) => j.id === id));
  }
  getJobs(tipos: string[]) {
    return Promise.resolve(this.jobs.filter((j) => tipos.includes(j.estado)));
  }
  getJobScheduler(id: string) {
    const next = this.agendamentos.get(id);
    return Promise.resolve(next === undefined ? undefined : { next });
  }
  getJobCounts(...tipos: string[]) {
    const contagem: Record<string, number> = {};
    for (const t of tipos) contagem[t] = this.jobs.filter((j) => j.estado === t).length;
    return Promise.resolve(contagem);
  }
}

function montar() {
  const fila = new FilaFalsa();
  const agendador = new FilaFalsa();
  let n = 0;
  const esperas: number[] = [];
  const execucoes = criarExecucoes({
    filaDoJob: () => fila,
    agendador,
    tokenSswGeradoEm: (empresaId) =>
      Promise.resolve(empresaId === A ? new Date("2026-11-10T11:25:00Z") : null),
    aplicacao: (empresaId) =>
      Promise.resolve(
        empresaId === A ? { pendentes: 1520, rodando: true } : { pendentes: 0, rodando: false },
      ),
    esperar: (ms) => {
      esperas.push(ms);
      const ultimo = fila.jobs.at(-1);
      if (ultimo && esperas.length === 2) ultimo.estado = "completed";
      return Promise.resolve();
    },
    gerarId: () => `id-${String(++n)}`,
  });
  return { fila, agendador, execucoes, esperas };
}

describe("execuções no BullMQ", () => {
  it("estados do BullMQ viram os do contrato (repetição pendente ainda está na fila)", () => {
    expect(estadoDoBullmq("completed")).toBe("concluida");
    expect(estadoDoBullmq("failed")).toBe("falhou");
    expect(estadoDoBullmq("active")).toBe("rodando");
    expect(estadoDoBullmq("delayed")).toBe("na_fila");
    expect(estadoDoBullmq("waiting-children")).toBe("na_fila");
  });

  it("pede com a empresa nos dados; deduplicado devolve criada: false", async () => {
    const { fila, execucoes } = montar();
    expect(await execucoes.pedir(A, "aplicar-ciclos", {}, "aplicar-ciclos__a")).toEqual({
      criada: true,
      execucaoId: "id-1",
    });
    expect(fila.jobs[0]?.data).toEqual({ empresaId: A });
    expect(await execucoes.pedir(A, "aplicar-ciclos", {}, "aplicar-ciclos__a")).toEqual({
      criada: false,
    });
    expect(await execucoes.pedir(A, "aplicar-ciclos", {}, null)).toMatchObject({ criada: true });
  });

  it("consulta espera até terminar dentro do prazo; outro job com o mesmo id não vale", async () => {
    const { execucoes, esperas } = montar();
    await execucoes.pedir(A, "bi2-0017", {}, null);
    expect(await execucoes.consultar("bi2-0017", "id-1", 0)).toEqual({ estado: "na_fila" });
    expect(esperas).toEqual([]);
    expect(await execucoes.consultar("bi2-0017", "id-1", 5_000)).toEqual({
      estado: "concluida",
      resultado: null,
    });
    expect(esperas).toEqual([500, 500]);
    expect(await execucoes.consultar("aplicar-ciclos", "id-1", 0)).toBeNull();
    expect(await execucoes.consultar("bi2-0017", "nao-existe", 0)).toBeNull();
  });

  it("situação: estado da mais recente da empresa, última terminada e próxima agendada", async () => {
    const { fila, agendador, execucoes } = montar();
    const falha = "Falha ao executar o job. Tente de novo; se persistir, avise o suporte.";
    fila.jobs.push(
      job("1", "sincronizar-ftp", "completed", { finishedOn: Date.parse("2026-11-10T12:00:00Z") }),
      job("2", "sincronizar-ftp", "failed", {
        finishedOn: Date.parse("2026-11-10T12:01:00Z"),
        failedReason: falha,
        attemptsMade: 3,
      }),
      job("3", "sincronizar-ftp", "active", { empresaId: B }),
      job("4", "bi2-0017", "waiting"),
    );
    agendador.agendamentos.set("ingestao:sincronizar-ftp", Date.parse("2026-11-10T12:02:00Z"));
    const situacao = await execucoes.situacao(A);
    expect(situacaoDaEmpresa.parse(situacao)).toEqual(situacao);
    expect(situacao.tokenSswGeradoEm).toBe("2026-11-10T11:25:00.000Z");
    expect(situacao.aplicacao).toEqual({ pendentes: 1520, rodando: true });
    expect(situacao.jobs.map((j) => j.job)).toContain("sla-arquivos");
    expect(situacao.jobs.find((j) => j.job === "sincronizar-ftp")).toMatchObject({
      job: "sincronizar-ftp",
      estado: "falhou",
      ultimaExecucao: {
        execucaoId: "2",
        estado: "falhou",
        terminadaEm: "2026-11-10T12:01:00.000Z",
        erro: falha,
      },
      proximaExecucao: "2026-11-10T12:02:00.000Z",
      agendado: true,
      ultimasFalhas: [
        { execucaoId: "2", quando: "2026-11-10T12:01:00.000Z", erro: falha, tentativas: 3 },
      ],
    });
    expect(situacao.jobs.find((j) => j.job === "bi2-0017")).toMatchObject({
      job: "bi2-0017",
      estado: "na_fila",
      agendado: false,
    });
    expect(situacao.jobs.find((j) => j.job === "aplicar-ciclos")).toMatchObject({
      job: "aplicar-ciclos",
      estado: "sem_execucao",
      ultimasFalhas: [],
    });
    expect(
      (await execucoes.situacao(B)).jobs.find((j) => j.job === "sincronizar-ftp"),
    ).toMatchObject({
      job: "sincronizar-ftp",
      estado: "rodando",
      proximaExecucao: "2026-11-10T12:02:00.000Z",
      ultimasFalhas: [],
    });
  });

  it("situação: contagens da fila, atrasados e no máximo 3 falhas da empresa, da mais nova", async () => {
    const { fila, execucoes } = montar();
    const em = (min: number) => Date.parse(`2026-11-10T12:0${String(min)}:00Z`);
    fila.jobs.push(
      job("w", "aplicar-ciclos", "waiting"),
      job("p", "aplicar-ciclos", "prioritized", { empresaId: B }),
      job("a", "aplicar-ciclos", "active"),
      job("d", "aplicar-ciclos", "delayed"),
      ...[1, 2, 3, 4].map((m) =>
        job(`f${String(m)}`, "aplicar-ciclos", "failed", {
          finishedOn: em(m),
          failedReason: `erro ${String(m)}`,
        }),
      ),
      job("fb", "aplicar-ciclos", "failed", { empresaId: B, finishedOn: em(5) }),
    );
    const situacao = await execucoes.situacao(A);
    const aplicar = situacao.jobs.find((j) => j.job === "aplicar-ciclos");
    expect(aplicar).toMatchObject({ naFila: 2, rodando: 1, atrasados: 1, falhos: 5 });
    expect(aplicar?.ultimasFalhas.map((f) => f.execucaoId)).toEqual(["f4", "f3", "f2"]);
    expect(situacaoDaEmpresa.parse(situacao)).toEqual(situacao);
  });
});
