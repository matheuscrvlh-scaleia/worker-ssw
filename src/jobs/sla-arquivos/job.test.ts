import { randomUUID } from "node:crypto";

import { type CandidatoSla, type SlaCalculado } from "@erp/dominio/performance/sla-arquivos";
import { JOBS_DE_INGESTAO } from "@erp/shared/ingestao";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { BancoFalso } from "../../testes/banco-falso";
import { criarProcessador } from "../processador";
import { type RepositoriosDoWorker } from "../registro";
import { calcularSlaArquivos, type RepositorioSlaArquivos, slaPelosArquivos } from "./job";

const EMPRESA = randomUUID();
// 22:30 de 10/11 em Brasília (já 11/11 em UTC).
const AGORA = new Date("2026-11-11T01:30:00Z");

function candidato(parcial: Partial<CandidatoSla>): CandidatoSla {
  return {
    id: "c1",
    dataPrevista: "2026-11-19",
    // 23/11 01:00 UTC = 22/11 (domingo) em Brasília; 20/11 é feriado nacional: 0 dia útil de atraso
    dataEntrega: new Date("2026-11-23T01:00:00Z"),
    temPendenciaCliente: false,
    performanceDias: null,
    noPrazo: null,
    responsabilidadeCliente: null,
    fontePerformance: null,
    camposSsw: ["data_entrega_realizada"],
    ...parcial,
  };
}

function repositorioFalso(candidatos: CandidatoSla[]) {
  const pedidos: string[] = [];
  const gravados: SlaCalculado[][] = [];
  const repo: RepositorioSlaArquivos = {
    feriados: () =>
      Promise.resolve([
        { data: "2026-11-20", tipo: "nacional" },
        { data: "2026-11-21", tipo: "municipal" },
      ]),
    candidatos: (_empresa, desde) => {
      pedidos.push(desde);
      return Promise.resolve(candidatos);
    },
    gravar: (alterados) => {
      gravados.push([...alterados]);
      return Promise.resolve();
    },
  };
  return { repo, pedidos, gravados };
}

describe("calcularSlaArquivos", () => {
  it("60 dias para trás pelo dia de Brasília; grava só quem mudou", async () => {
    const pronto = candidato({
      id: "c2",
      dataEntrega: new Date("2026-11-19T15:00:00Z"),
      performanceDias: 0,
      noPrazo: true,
      responsabilidadeCliente: false,
      fontePerformance: "ssw_arquivos",
      camposSsw: [
        "data_entrega_realizada",
        "fonte_performance",
        "no_prazo",
        "performance_dias",
        "responsabilidade_cliente",
      ],
    });
    const { repo, pedidos, gravados } = repositorioFalso([candidato({}), pronto]);
    const r = await calcularSlaArquivos(repo, EMPRESA, AGORA, null);
    expect(pedidos).toEqual(["2026-09-11"]);
    expect(r).toEqual({ desde: "2026-09-11", candidatos: 2, alterados: 1 });
    expect(gravados[0]).toMatchObject([
      { id: "c1", performanceDias: 0, noPrazo: true, responsabilidadeCliente: false },
    ]);
  });

  it("nada mudou: não grava", async () => {
    const { repo, gravados } = repositorioFalso([]);
    expect(await calcularSlaArquivos(repo, EMPRESA, AGORA, "2025-01-01")).toEqual({
      desde: "2025-12-01",
      candidatos: 0,
      alterados: 0,
    });
    expect(gravados).toEqual([]);
  });
});

describe("job sla-pelos-arquivos", () => {
  it("por empresa, disparado pelo catálogo de ingestão, no contexto da empresa", async () => {
    expect(slaPelosArquivos).toMatchObject({
      escopo: "empresa",
      fila: "ingestao.sla-arquivos",
      agendamento: null,
    });
    expect(JOBS_DE_INGESTAO.find((j) => j.job === "sla-arquivos")?.cron).toBe("8,38 * * * *");
    const { repo, pedidos } = repositorioFalso([]);
    const contextos: unknown[] = [];
    const processar = criarProcessador({
      jobs: [slaPelosArquivos],
      executar: (contexto, fn) => {
        contextos.push(contexto);
        return new BancoFalso().executar(contexto, (repositorios: RepositoriosDoWorker) =>
          fn({ ...repositorios, slaArquivos: repo }),
        );
      },
      log: pino({ level: "silent" }),
      agora: () => AGORA,
    });
    await processar({
      name: "sla-arquivos",
      data: { empresaId: EMPRESA, desde: "2026-10-01" },
    });
    expect(contextos).toEqual([{ empresaId: EMPRESA, usuarioId: null, plataforma: false }]);
    expect(pedidos).toEqual(["2026-10-01"]);
  });
});
