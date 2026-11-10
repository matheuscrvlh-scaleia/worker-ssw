import { describe, expect, it } from "vitest";

import { BAIXA_FR, ocorrencia } from "../testes/nucleo";
import {
  atrasoDias,
  type CteParaSituacao,
  emRota,
  estaSemMovimento,
  faixaPrevisao,
  saiuParaEntrega,
  statusPrevisto,
} from "./situacao";

const HOJE_10_11 = new Date("2026-11-10T15:00:00Z");
const d = (iso: string) => new Date(iso);

const cte = (extra: Partial<CteParaSituacao> = {}): CteParaSituacao => ({
  dataEmissao: "2026-11-01",
  criadoEm: d("2026-11-01T12:00Z"),
  dataPrevistaEntrega: null,
  dataEntregaRealizada: null,
  ocorrEfetivaCodigo: null,
  ocorrEfetivaData: null,
  performanceDias: null,
  responsabilidadeCliente: null,
  ultimaOcorrCodigo0013: null,
  ultOcorrCodigo0174: null,
  ...extra,
});

describe("atrasoDias (§5.1)", () => {
  it.each<[string | null, string | null, string | null, number | null, number | null]>([
    ["2026-11-05", "2026-11-06T02:59Z", "1", null, 0],
    ["2026-11-05", "2026-11-07T15:00Z", "1", null, 2],
    ["2026-11-05", null, "85", null, 5],
    ["2026-11-12", null, "85", null, -2],
    ["2026-11-05", null, "1", 2, 2],
    ["2026-11-05", null, "18", null, null],
    ["2026-11-05", null, "12", null, null],
    ["2026-11-05", null, null, null, 5],
    [null, "2026-11-07T15:00Z", "1", 3, null],
  ])("previsão %j, entrega %j, efetiva %j, perf %j → %j", (prev, ent, cod, perf, esperado) => {
    const c = cte({
      dataPrevistaEntrega: prev,
      dataEntregaRealizada: ent === null ? null : d(ent),
      ocorrEfetivaCodigo: cod,
      performanceDias: perf,
    });
    expect(atrasoDias(c, BAIXA_FR, HOJE_10_11)).toBe(esperado);
  });

  it("'hoje' é o dia de Brasília: 23:30 de 10/11 ainda é 10/11", () => {
    const c = cte({ dataPrevistaEntrega: "2026-11-05" });
    expect(atrasoDias(c, BAIXA_FR, d("2026-11-11T02:30Z"))).toBe(5);
  });
});

describe("estaSemMovimento (§5.2, limite 3, hoje 2026-11-10)", () => {
  const aberto = { dataPrevistaEntrega: "2026-11-05", ocorrEfetivaCodigo: "85" };

  it("atraso 5 > 3 e 4 dias desde a efetiva → sem movimento", () => {
    const c = cte({ ...aberto, ocorrEfetivaData: d("2026-11-06T13:00Z") });
    expect(estaSemMovimento(c, 3, BAIXA_FR, HOJE_10_11)).toBe(true);
  });

  it("efetiva em 11-08 → 2 dias → não", () => {
    const c = cte({ ...aberto, ocorrEfetivaData: d("2026-11-08T13:00Z") });
    expect(estaSemMovimento(c, 3, BAIXA_FR, HOJE_10_11)).toBe(false);
  });

  it("sem efetiva conta desde a emissão (11-01 → 9 dias)", () => {
    const c = cte({ dataPrevistaEntrega: "2026-11-05" });
    expect(estaSemMovimento(c, 3, BAIXA_FR, HOJE_10_11)).toBe(true);
  });

  it("atraso 2 não passa do limite; responsabilidade do cliente, entregue e baixado não contam", () => {
    expect(
      estaSemMovimento(cte({ dataPrevistaEntrega: "2026-11-08" }), 3, BAIXA_FR, HOJE_10_11),
    ).toBe(false);
    const parado = { dataPrevistaEntrega: "2026-11-05" };
    expect(
      estaSemMovimento(cte({ ...parado, responsabilidadeCliente: true }), 3, BAIXA_FR, HOJE_10_11),
    ).toBe(false);
    expect(
      estaSemMovimento(cte({ ...parado, ocorrEfetivaCodigo: "1" }), 3, BAIXA_FR, HOJE_10_11),
    ).toBe(false);
    expect(
      estaSemMovimento(cte({ ...parado, ocorrEfetivaCodigo: "12" }), 3, BAIXA_FR, HOJE_10_11),
    ).toBe(false);
  });
});

describe("faixaPrevisao (§5.4, hoje 2026-11-10)", () => {
  it.each([
    [null, "sem_prev"],
    ["2026-11-09", "vencido"],
    ["2026-11-10", "hoje"],
    ["2026-11-11", "d1"],
    ["2026-11-12", "d2"],
    ["2026-11-13", "d3_mais"],
  ])("%j → %s", (prev, faixa) => {
    expect(faixaPrevisao(prev, HOJE_10_11)).toBe(faixa);
  });

  it("depois das 21h de Brasília o que vence hoje continua 'hoje' (Q11)", () => {
    expect(faixaPrevisao("2026-11-10", d("2026-11-11T01:30Z"))).toBe("hoje");
  });
});

describe("statusPrevisto (§5.5)", () => {
  it("a ordem importa", () => {
    expect(statusPrevisto(35, "PENDENCIA_CLIENTE")).toBe("agendamento");
    expect(statusPrevisto(7, null)).toBe("rota");
    expect(statusPrevisto(9, "PENDENCIA_CLIENTE")).toBe("pendencia");
    expect(statusPrevisto(null, null)).toBe("programacao");
    expect(statusPrevisto(84, "INFORMATIVA")).toBe("programacao");
    expect(statusPrevisto(88, "INFORMATIVA")).toBe("outros");
  });
});

describe("saiuParaEntrega (§5.6)", () => {
  it("entregue, ou código de saída nas colunas", () => {
    expect(saiuParaEntrega(cte({ ocorrEfetivaCodigo: "1" }), [])).toBe("sim");
    expect(saiuParaEntrega(cte({ ultOcorrCodigo0174: "085" }), [])).toBe("sim");
  });

  it("só saída em quarentena → quarentena; sem saída → não rastreado", () => {
    expect(saiuParaEntrega(cte(), [ocorrencia(9, "2026-11-05T12:00Z", { quarentena: true })])).toBe(
      "quarentena",
    );
    expect(
      saiuParaEntrega(cte(), [
        ocorrencia(80, "2026-11-02T12:00Z"),
        ocorrencia(82, "2026-11-03T12:00Z"),
      ]),
    ).toBe("nao_rastreado");
    expect(saiuParaEntrega(cte(), [ocorrencia(9, "2026-11-05T12:00Z")])).toBe("sim");
  });

  it("código com letra na coluna vira sem código (Q54)", () => {
    expect(saiuParaEntrega(cte({ ultimaOcorrCodigo0013: "85A" }), [])).toBe("nao_rastreado");
  });
});

describe("emRota (§5.7)", () => {
  const em85 = cte({ ocorrEfetivaCodigo: "85" });

  it("efetiva 85 sem nenhuma 85 gravada (veio de foto) → em rota", () => {
    expect(emRota(em85, [])).toBe(true);
    expect(emRota(cte({ ocorrEfetivaCodigo: "88" }), [])).toBe(false);
  });

  it("85 gravada precisa ser do dia da emissão em diante (Brasília, Q11) e lançada depois do CT-e", () => {
    const naVespera = ocorrencia(85, "2026-11-01T01:30Z", { criadoEm: d("2026-11-02T00:00Z") });
    expect(emRota(em85, [naVespera])).toBe(false);
    const valida = ocorrencia(85, "2026-11-01T03:00Z", { criadoEm: d("2026-11-02T00:00Z") });
    expect(emRota(em85, [valida])).toBe(true);
    const lancadaAntes = ocorrencia(85, "2026-11-02T12:00Z", { criadoEm: d("2026-11-01T11:00Z") });
    expect(emRota(em85, [lancadaAntes])).toBe(false);
  });

  it("85 em quarentena não conta (Q21)", () => {
    const quarentena = ocorrencia(85, "2026-10-30T12:00Z", { quarentena: true });
    expect(emRota(em85, [quarentena])).toBe(true);
  });
});
