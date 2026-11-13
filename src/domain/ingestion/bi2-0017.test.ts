import { describe, expect, it } from "vitest";

import {
  type CtePara0017,
  datasDoCiclo0017,
  entregaEPrevisaoDoBi2,
  type Linha0017,
  prazoAjustadoDepoisDaEntrega,
  ultimaPorCte,
  vazioQuandoNaoEncontrado,
} from "./bi2-0017";

const entrega = new Date("2026-11-04T15:00:00-03:00");

const cte = (extra: Partial<CtePara0017> = {}): CtePara0017 => ({
  dataEmissao: "2026-11-01",
  dataEntregaRealizada: entrega,
  dataPrevistaEntrega: "2026-11-03",
  prazoEntrega: "2026-11-03",
  camposSsw: [],
  ...extra,
});

const linha = (extra: Partial<Linha0017> = {}): Linha0017 => ({
  numero: "33214",
  dataEmissao: "2026-11-01",
  dataPrevistaEntrega: "2026-11-05",
  dataEntregaRealizada: entrega,
  ...extra,
});

describe("BI2 0017 — passo 1 (entrega e previsão)", () => {
  it("coluna que veio do SSW fica; sem previsão no BI2 mantém a do CT-e", () => {
    expect(
      entregaEPrevisaoDoBi2(cte({ camposSsw: ["data_prevista_entrega"] }), linha()),
    ).toBeNull();
    expect(
      entregaEPrevisaoDoBi2(
        cte({ dataEntregaRealizada: null }),
        linha({ dataPrevistaEntrega: null }),
      ),
    ).toEqual({ dataEntregaRealizada: entrega, dataPrevistaEntrega: "2026-11-03" });
  });

  it("igual ao gravado não muda", () => {
    expect(entregaEPrevisaoDoBi2(cte(), linha({ dataPrevistaEntrega: "2026-11-03" }))).toBeNull();
  });
});

describe("BI2 0017 — passo 2 (prazo ajustado depois da entrega)", () => {
  it("entregue com previsão nova ≥ emissão troca previsão e prazo (eram iguais)", () => {
    expect(prazoAjustadoDepoisDaEntrega(cte(), linha())).toEqual({
      dataPrevistaEntrega: "2026-11-05",
      prazoEntrega: "2026-11-05",
      prazoFonte: "bi2",
    });
    expect(
      prazoAjustadoDepoisDaEntrega(cte({ prazoEntrega: "2026-11-02" }), linha()),
    ).toMatchObject({ prazoEntrega: "2026-11-02" });
    expect(
      prazoAjustadoDepoisDaEntrega(cte({ prazoEntrega: null, dataPrevistaEntrega: null }), linha()),
    ).toMatchObject({ prazoEntrega: "2026-11-05" });
  });

  it("não entregue, previsão antes da emissão ou igual: nada", () => {
    expect(prazoAjustadoDepoisDaEntrega(cte({ dataEntregaRealizada: null }), linha())).toBeNull();
    expect(
      prazoAjustadoDepoisDaEntrega(cte(), linha({ dataPrevistaEntrega: "2026-10-30" })),
    ).toBeNull();
    expect(
      prazoAjustadoDepoisDaEntrega(cte(), linha({ dataPrevistaEntrega: "2026-11-03" })),
    ).toBeNull();
  });
});

describe("BI2 0017 — datas e 404", () => {
  it("repetida no lote: vale a última", () => {
    const a = linha({ dataPrevistaEntrega: "2026-11-05" });
    const b = linha({ dataPrevistaEntrega: "2026-11-07" });
    expect(ultimaPorCte([a, b])).toEqual([b]);
  });

  it("404 com fechamento na segunda (conteúdo domingo) ou hoje = vazio", () => {
    expect(vazioQuandoNaoEncontrado("2026-11-09", "2026-11-10")).toBe(true);
    expect(vazioQuandoNaoEncontrado("2026-11-08", "2026-11-10")).toBe(true);
    expect(vazioQuandoNaoEncontrado("2026-11-10", "2026-11-10")).toBe(true);
    expect(vazioQuandoNaoEncontrado("2026-11-05", "2026-11-10")).toBe(false);
  });

  it("contínuo: hoje + 2 dias; manual: ontem; lookback limitado a 7", () => {
    const hoje = "2026-11-10";
    expect(datasDoCiclo0017({ modo: "cron_continuo", data: null, lookback: null, hoje })).toEqual([
      "2026-11-10",
      "2026-11-09",
      "2026-11-08",
    ]);
    expect(datasDoCiclo0017({ modo: "manual", data: null, lookback: null, hoje })).toEqual([
      "2026-11-09",
    ]);
    expect(
      datasDoCiclo0017({ modo: "manual", data: "2026-10-01", lookback: 30, hoje }),
    ).toHaveLength(8);
  });
});
