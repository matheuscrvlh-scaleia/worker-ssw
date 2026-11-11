import { randomUUID } from "node:crypto";

import { ErroDeNegocio } from "@erp/domain/errors";
import { ehJobDeIngestao, JOBS_DE_INGESTAO } from "@erp/shared/ingestion";
import { z } from "@erp/shared/zod";
import { UnrecoverableError } from "bullmq";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { BancoFalso, EMPRESA as EMPRESA_DO_BANCO } from "../testes/banco-falso";
import {
  agendamentosDesejados,
  type FilaAgendavel,
  sincronizarAgendamentos,
} from "./agendamentos/agendamentos";
import { criarJobsDaIngestao } from "./ingestao/jobs";
import { limparIngestaoSsw } from "./manutencao/job";
import { criarProcessador, MENSAGEM_DE_FALHA } from "./processador";
import { definirJob } from "./registro";

const log = pino({ level: "silent" });
const EMPRESA = randomUUID();

/** Job da Plataforma só do teste (o worker-ssw não tem nenhum agendado além do despachante). */
const daPlataforma = definirJob({
  nome: "conferir-plataforma",
  fila: "manutencao",
  escopo: "plataforma",
  dados: z.object({}),
  agendamento: "0 3 * * *",
  processar: async ({ executar }) => {
    await executar(() => Promise.resolve(null));
  },
});

const porEmpresa = definirJob({
  nome: "conferir-empresa",
  fila: "manutencao",
  escopo: "empresa",
  dados: z.object({ empresaId: z.uuid() }),
  agendamento: "*/30 * * * *",
  processar: async ({ executar, empresaId }) => {
    await executar(() => Promise.resolve(empresaId));
  },
});

describe("processador", () => {
  it("roda job da Plataforma no contexto da Plataforma", async () => {
    const banco = new BancoFalso();
    const processar = criarProcessador({
      jobs: [daPlataforma],
      executar: banco.executar,
      log,
      agora: () => new Date(),
    });
    await processar({ name: "conferir-plataforma", data: {} });
    expect(banco.contextos).toEqual([{ empresaId: null, usuarioId: null, plataforma: true }]);
  });

  it("roda job por empresa com o contexto da empresa (igual à API)", async () => {
    const banco = new BancoFalso();
    const processar = criarProcessador({
      jobs: [porEmpresa],
      executar: banco.executar,
      log,
      agora: () => new Date(),
    });
    await processar({ name: "conferir-empresa", data: { empresaId: EMPRESA } });
    expect(banco.contextos).toEqual([{ empresaId: EMPRESA, usuarioId: null, plataforma: false }]);
  });

  it("falha sai com mensagem para o operador; o detalhe interno fica só no log", async () => {
    const falhar = (erro: Error) =>
      definirJob({
        nome: "falha",
        fila: "manutencao",
        escopo: "empresa",
        dados: z.object({ empresaId: z.uuid() }),
        agendamento: null,
        processar: () => Promise.reject(erro),
      });
    const rodar = (erro: Error) =>
      criarProcessador({
        jobs: [falhar(erro)],
        executar: new BancoFalso().executar,
        log,
        agora: () => new Date(),
      })({ name: "falha", data: { empresaId: EMPRESA } });
    await expect(rodar(new Error("Failed query: insert ... params: dado"))).rejects.toThrow(
      new Error(MENSAGEM_DE_FALHA),
    );
    const negocio = new ErroDeNegocio("CONFLITO", "Integração SFTP desligada.");
    await expect(rodar(negocio)).rejects.toBe(negocio);
  });

  it("job desconhecido ou dado inválido não é repetido", async () => {
    const banco = new BancoFalso();
    const processar = criarProcessador({
      jobs: [porEmpresa],
      executar: banco.executar,
      log,
      agora: () => new Date(),
    });
    await expect(processar({ name: "nao-existe", data: {} })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(
      processar({ name: "conferir-empresa", data: { empresaId: "x" } }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(banco.contextos).toEqual([]);
  });
});

describe("retenção da ingestão SSW/BI2", () => {
  it("90 dias para webhook e SSW API, 400 para o BI2, no contexto da empresa", async () => {
    const banco = new BancoFalso();
    const processar = criarProcessador({
      jobs: [limparIngestaoSsw],
      executar: banco.executar,
      log,
      agora: () => new Date("2026-11-10T06:50:00Z"),
    });
    await processar({ name: "limpar-ingestao-ssw", data: { empresaId: EMPRESA } });
    expect(banco.contextos).toEqual([{ empresaId: EMPRESA, usuarioId: null, plataforma: false }]);
    expect(banco.retencoesSsw).toEqual([
      {
        registrosSsw: new Date("2026-08-12T06:50:00Z"),
        bi2: new Date("2025-10-06T06:50:00Z"),
      },
    ]);
  });
});

describe("agendamentos", () => {
  const empresas = [{ id: EMPRESA, fuso: "America/Manaus" }];

  it("um por job da Plataforma e um por empresa nos jobs por empresa, no fuso dela", () => {
    expect(agendamentosDesejados([daPlataforma, porEmpresa], empresas)).toEqual([
      {
        id: "conferir-plataforma",
        job: "conferir-plataforma",
        padrao: "0 3 * * *",
        fuso: "America/Sao_Paulo",
        dados: {},
      },
      {
        id: `conferir-empresa:${EMPRESA}`,
        job: "conferir-empresa",
        padrao: "*/30 * * * *",
        fuso: "America/Manaus",
        dados: { empresaId: EMPRESA },
      },
    ]);
  });

  function filaFalsa(existentes: string[]) {
    const chaves = new Set(existentes);
    const fila: FilaAgendavel = {
      getJobSchedulers: () => Promise.resolve([...chaves].map((key) => ({ key }))),
      upsertJobScheduler: (id) => Promise.resolve(chaves.add(id)),
      removeJobScheduler: (id) => Promise.resolve(chaves.delete(id)),
    };
    return { fila, chaves };
  }

  it("sincroniza: cria os que faltam e remove os que sobraram", async () => {
    const { fila, chaves } = filaFalsa(["conferir-empresa:empresa-desativada"]);
    const desejados = agendamentosDesejados([daPlataforma, porEmpresa], empresas);
    expect(await sincronizarAgendamentos(fila, desejados)).toEqual({ criados: 2, removidos: 1 });
    expect([...chaves].sort()).toEqual([`conferir-empresa:${EMPRESA}`, "conferir-plataforma"]);
  });

  it("desligados por env: nenhum agendamento fica na fila", async () => {
    const { fila, chaves } = filaFalsa(["conferir-plataforma"]);
    await sincronizarAgendamentos(fila, []);
    expect(chaves.size).toBe(0);
  });
});

describe("jobs da ingestão por arquivo", () => {
  const jobs = criarJobsDaIngestao(
    // Os jobs testados aqui não usam Redis, SFTP nem cofre.
    {} as unknown as Parameters<typeof criarJobsDaIngestao>[0],
  );

  it("têm os nomes e as filas do catálogo, sob demanda (quem agenda é o despachante)", () => {
    for (const j of jobs) {
      expect(ehJobDeIngestao(j.nome)).toBe(true);
      expect(j.fila).toBe(`ingestao.${j.nome}`);
      expect(j.escopo).toBe("empresa");
      expect(j.agendamento).toBeNull();
    }
    expect(jobs.map((j) => j.nome)).toEqual(
      JOBS_DE_INGESTAO.filter((j) => ["sftp", "ssw_web", "xml_cte"].includes(j.integracao)).map(
        (j) => j.job,
      ),
    );
  });

  it("limpar-ingestao-arquivos aplica a retenção no contexto da empresa", async () => {
    const banco = new BancoFalso();
    const processar = criarProcessador({
      jobs,
      executar: banco.executar,
      log,
      agora: () => new Date("2026-11-10T06:40:00Z"),
    });
    await processar({ name: "limpar-ingestao-arquivos", data: { empresaId: EMPRESA_DO_BANCO } });
    expect(banco.contextos).toEqual([
      { empresaId: EMPRESA_DO_BANCO, usuarioId: null, plataforma: false },
    ]);
    expect(banco.retencoes).toContainEqual(new Date("2026-09-11T06:40:00Z"));
  });

  it("sla-arquivos passa a unidade pelo 455 antes do SLA, tudo no contexto da empresa", async () => {
    const banco = new BancoFalso();
    const processar = criarProcessador({
      jobs,
      executar: banco.executar,
      log,
      agora: () => new Date(),
    });
    await processar({ name: "sla-arquivos", data: { empresaId: EMPRESA_DO_BANCO } });
    // Uma transação da unidade pelo 455 (sem 455 recente) e uma do SLA.
    expect(banco.contextos).toEqual([
      { empresaId: EMPRESA_DO_BANCO, usuarioId: null, plataforma: false },
      { empresaId: EMPRESA_DO_BANCO, usuarioId: null, plataforma: false },
    ]);
  });
});
