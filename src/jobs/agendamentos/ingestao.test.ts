import { JOBS_DE_INGESTAO } from "@erp/shared/ingestion";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { BancoFalso } from "../../testes/banco-falso";
import { type ContextoDoJob } from "../registro";
import {
  agendamentosDeIngestao,
  criarDespachante,
  empresasDoDisparo,
  type Enfileirador,
} from "./ingestao";

const log = pino({ level: "silent" });
const bi2 = JOBS_DE_INGESTAO.find((j) => j.job === "bi2-0017");
const ftp = JOBS_DE_INGESTAO.find((j) => j.job === "sincronizar-ftp");

describe("agendador da ingestão", () => {
  it("agenda só o que está ligado no ambiente e tem handler, no horário UTC de hoje", () => {
    const registrados = new Set(["bi2-0017", "verificar-token-ssw", "processar-webhook-ssw"]);
    expect(
      agendamentosDeIngestao(["bi2-0017", "sincronizar-ftp", "processar-webhook-ssw"], registrados),
    ).toEqual([
      {
        id: "ingestao:bi2-0017",
        job: "despachar_ingestao",
        padrao: "12,42 * * * *",
        fuso: "UTC",
        dados: { job: "bi2-0017" },
      },
    ]);
    expect(agendamentosDeIngestao([], registrados)).toEqual([]);
  });

  it("BI2 em rodízio: uma empresa por disparo, pela posição do minuto", () => {
    if (!bi2 || !ftp) throw new Error("catálogo sem bi2-0017/ftp");
    const empresas = ["a", "b", "c"];
    const minuto = (m: number) => new Date(m * 60_000);
    expect(empresasDoDisparo(bi2, empresas, minuto(12))).toEqual(["a"]);
    expect(empresasDoDisparo(bi2, empresas, minuto(13))).toEqual(["b"]);
    expect(empresasDoDisparo(ftp, empresas, minuto(13))).toEqual(empresas);
    expect(empresasDoDisparo(bi2, [], minuto(13))).toEqual([]);
  });

  it("despachante enfileira uma execução por empresa com a integração ligada, deduplicada", async () => {
    const banco = new BancoFalso();
    banco.empresas = [
      { id: "e1", integracoes: ["sftp", "ssw_api"] },
      { id: "e2", integracoes: ["ssw_api"] },
      { id: "e3", integracoes: ["sftp"] },
    ];
    const enfileirados: unknown[] = [];
    const enfileirador: Enfileirador = {
      enfileirar: (job, dados, opcoes) => {
        enfileirados.push({ job, dados, opcoes });
        return Promise.resolve();
      },
    };
    const despachante = criarDespachante(enfileirador);
    await despachante.processar(
      {
        executar: (fn) =>
          banco.executar({ empresaId: null, usuarioId: null, plataforma: true }, fn),
        empresaId: null,
        log,
        agora: () => new Date("2026-11-10T12:25:00Z"),
      },
      { job: "sincronizar-ftp-retroativo" },
    );
    expect(enfileirados).toEqual([
      {
        job: "sincronizar-ftp-retroativo",
        dados: { retroativo: true, empresaId: "e1" },
        opcoes: { deduplicar: "sincronizar-ftp-retroativo__e1" },
      },
      {
        job: "sincronizar-ftp-retroativo",
        dados: { retroativo: true, empresaId: "e3" },
        opcoes: { deduplicar: "sincronizar-ftp-retroativo__e3" },
      },
    ]);
    expect(banco.contextos).toEqual([{ empresaId: null, usuarioId: null, plataforma: true }]);
  });

  it("a aplicação roda em quem recebe pelo SFTP e em quem baixa do SSW web (ADR 0013)", async () => {
    const banco = new BancoFalso();
    banco.empresas = [
      { id: "e1", integracoes: ["sftp"] },
      { id: "e2", integracoes: ["ssw_web"] },
      { id: "e3", integracoes: ["ssw_api"] },
    ];
    const empresas: unknown[] = [];
    const despachante = criarDespachante({
      enfileirar: (_job, dados) => Promise.resolve(void empresas.push(dados.empresaId)),
    });
    const contexto: ContextoDoJob = {
      executar: (fn) => banco.executar({ empresaId: null, usuarioId: null, plataforma: true }, fn),
      empresaId: null,
      log,
      agora: () => new Date("2026-11-10T12:25:00Z"),
    };
    await despachante.processar(contexto, { job: "aplicar-ciclos" });
    expect(empresas).toEqual(["e1", "e2"]);
    empresas.length = 0;
    await despachante.processar(contexto, { job: "baixar-relatorios-ssw" });
    expect(empresas).toEqual(["e2"]);
  });
});
