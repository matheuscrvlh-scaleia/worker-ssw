import { describe, expect, it } from "vitest";

import { CATALOGO_FR, cte, ocorrencia } from "../tests/core";
import { calcularOcorrenciaEfetiva, statusAtual } from "./effective-occurrence";

const efetiva = (...args: Parameters<typeof calcularOcorrenciaEfetiva>) => {
  const e = calcularOcorrenciaEfetiva(...args);
  return { codigo: e.ocorrEfetivaCodigo, fonte: e.ocorrEfetivaFonte };
};
const d = (iso: string) => new Date(iso);

describe("ocorrência efetiva — exemplos da spec (§4.1, emissão 2026-11-03)", () => {
  it("E1: baixa vence o 88 posterior", () => {
    const oc = [ocorrencia(12, "2026-11-05T13:00Z"), ocorrencia(88, "2026-11-06T13:00Z")];
    expect(efetiva(cte(), oc, CATALOGO_FR)).toEqual({ codigo: "12", fonte: "webhook" });
  });

  it("E2: conclusivo vence o mais recente", () => {
    const c = cte({ ultOcorrCodigo0174: "85", ultOcorrData0174: d("2026-11-05T11:00Z") });
    const oc = [ocorrencia(1, "2026-11-04T15:00Z")];
    expect(efetiva(c, oc, CATALOGO_FR)).toEqual({ codigo: "1", fonte: "webhook" });
  });

  it("E3: empate → prioridade 0174 > webhook; código gravado sem zero à esquerda", () => {
    const c = cte({ ultOcorrCodigo0174: "01", ultOcorrData0174: d("2026-11-05T13:00Z") });
    const oc = [ocorrencia(1, "2026-11-05T13:00Z")];
    expect(efetiva(c, oc, CATALOGO_FR)).toEqual({ codigo: "1", fonte: "bi2_0174" });
  });

  it("E4: 036 que não é entrega não tira a entrega do lugar", () => {
    const c = cte({ ocorr036Codigo: "12", ocorr036Data: d("2026-11-06T13:00Z") });
    const oc = [ocorrencia(1, "2026-11-05T13:00Z")];
    expect(efetiva(c, oc, CATALOGO_FR)).toEqual({ codigo: "1", fonte: "webhook" });
  });

  it("E5: dois conclusivos → o mais recente", () => {
    const c = cte({ ocorr036Codigo: "1", ocorr036Data: d("2026-11-04T13:00Z") });
    const oc = [ocorrencia(12, "2026-11-05T13:00Z")];
    expect(efetiva(c, oc, CATALOGO_FR)).toEqual({ codigo: "12", fonte: "webhook" });
  });

  it("E6: ocorrência antes da emissão (22:00 de Brasília da véspera) não entra", () => {
    const oc = [ocorrencia(85, "2026-11-03T01:00Z")];
    expect(calcularOcorrenciaEfetiva(cte(), oc, CATALOGO_FR)).toEqual({
      ocorrEfetivaCodigo: null,
      ocorrEfetivaDescricao: null,
      ocorrEfetivaData: null,
      ocorrEfetivaFonte: null,
      ocorrEfetivaLocal: null,
    });
  });

  it("E7: quarentena não entra; vale o 0013", () => {
    const c = cte({ ultimaOcorrCodigo0013: "82", ultimaOcorrData0013: d("2026-11-04T12:00Z") });
    const oc = [ocorrencia(85, "2026-11-05T12:00Z", { quarentena: true })];
    expect(efetiva(c, oc, CATALOGO_FR)).toEqual({ codigo: "82", fonte: "bi2_0013" });
  });

  it("E8: entre linhas gravadas, código sem tipo perde para não conclusivo mais antigo", () => {
    const oc = [ocorrencia(85, "2026-11-05T13:00Z"), ocorrencia(50, "2026-11-06T13:00Z")];
    expect(efetiva(cte(), oc, CATALOGO_FR)).toEqual({ codigo: "85", fonte: "webhook" });
  });

  it("E9: descrição vazia do 0174 é mantida; instrução vazia cai no local", () => {
    const c = cte({
      ultOcorrCodigo0174: "85",
      ultOcorrData0174: d("2026-11-06T10:00Z"),
      ultOcorrDescricao0174: "",
      ultOcorrInstrucao0174: "",
      ultOcorrLocal0174: "RIO",
    });
    expect(calcularOcorrenciaEfetiva(c, [], CATALOGO_FR)).toMatchObject({
      ocorrEfetivaCodigo: "85",
      ocorrEfetivaDescricao: "",
      ocorrEfetivaLocal: "RIO",
      ocorrEfetivaFonte: "bi2_0174",
    });
  });

  it("E10: empate 036 × 0174 → 036 (prioridade 4)", () => {
    const c = cte({
      ocorr036Codigo: "85",
      ocorr036Data: d("2026-11-06T10:00Z"),
      ultOcorrCodigo0174: "85",
      ultOcorrData0174: d("2026-11-06T10:00Z"),
    });
    expect(efetiva(c, [], CATALOGO_FR)).toEqual({ codigo: "85", fonte: "ssw_036" });
  });

  it("E11: sem nenhuma fonte, tudo nulo", () => {
    expect(efetiva(cte(), [], CATALOGO_FR)).toEqual({ codigo: null, fonte: null });
  });
});

describe("ocorrência efetiva — casos-limite", () => {
  it("descrição: gravada › cadastro; 036 vazia cai no cadastro", () => {
    const c = cte({
      ocorr036Codigo: "85",
      ocorr036Descricao: "",
      ocorr036Data: d("2026-11-06T10:00Z"),
    });
    expect(calcularOcorrenciaEfetiva(c, [], CATALOGO_FR).ocorrEfetivaDescricao).toBe(
      "SAIDA PARA ENTREGA",
    );
    const oc = [ocorrencia(85, "2026-11-05T10:00Z", { descricao: "Saiu" })];
    expect(calcularOcorrenciaEfetiva(cte(), oc, CATALOGO_FR).ocorrEfetivaDescricao).toBe("Saiu");
  });

  it("foto com código vazio ou sem data não é candidata", () => {
    const c = cte({ ultOcorrCodigo0174: "", ultOcorrData0174: d("2026-11-06T10:00Z") });
    expect(efetiva(c, [], CATALOGO_FR).codigo).toBeNull();
    const semData = cte({ ultimaOcorrCodigo0013: "85" });
    expect(efetiva(semData, [], CATALOGO_FR).codigo).toBeNull();
  });

  it("empate de data entre linhas gravadas: vence a gravada por último (Q07)", () => {
    const oc = [
      ocorrencia(85, "2026-11-05T13:00Z", { id: "b", criadoEm: d("2026-11-05T14:00Z") }),
      ocorrencia(88, "2026-11-05T13:00Z", { id: "a", criadoEm: d("2026-11-05T15:00Z") }),
    ];
    expect(efetiva(cte(), oc, CATALOGO_FR).codigo).toBe("88");
  });
});

describe("status atual (§4.3)", () => {
  it("descrição da ocorrência gravada mais recente, ou a do cadastro", () => {
    const oc = [ocorrencia(12, "2026-11-05T13:00Z"), ocorrencia(88, "2026-11-06T13:00Z")];
    expect(statusAtual(oc, CATALOGO_FR)).toBe("COMPROVANTE DIGITALIZADO");
  });

  it("quarentena fica de fora (Q21); sem ocorrência não mexe (null)", () => {
    const oc = [
      ocorrencia(85, "2026-11-05T13:00Z", { descricao: "Saiu" }),
      ocorrencia(88, "2026-11-06T13:00Z", { quarentena: true }),
    ];
    expect(statusAtual(oc, CATALOGO_FR)).toBe("Saiu");
    expect(statusAtual([], CATALOGO_FR)).toBeNull();
  });
});
