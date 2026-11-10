import { describe, expect, it } from "vitest";

import { BAIXA_FR } from "../testes/nucleo";
import {
  codigoSituacao,
  dataConclusaoEfetiva,
  estaEntregue,
  estaFinalizadoSemEntrega,
} from "./finalizacao";

const entrega = new Date("2026-11-05T15:00:00Z");

describe("estaEntregue (§3.1)", () => {
  it.each([
    [entrega, "85", true],
    [null, "18", true],
    [null, "01", true],
    [null, "2", false],
    [null, null, false],
  ])("(%j, %j) → %j", (data, codigo, esperado) => {
    expect(estaEntregue(data, codigo)).toBe(esperado);
  });
});

describe("estaFinalizadoSemEntrega (§3.2)", () => {
  it.each([
    [null, "12", true],
    [null, "99", true],
    [entrega, "12", false],
    [null, "85", false],
    [null, "1", false],
    [null, null, false],
  ])("(%j, %j) → %j", (data, codigo, esperado) => {
    expect(estaFinalizadoSemEntrega(data, codigo, BAIXA_FR)).toBe(esperado);
  });
});

describe("codigoSituacao (§3.3)", () => {
  it("entrega com efetiva que não é ENTREGA/BAIXA conta como 1", () => {
    expect(codigoSituacao(entrega, "88", "INFORMATIVA")).toBe(1);
    expect(codigoSituacao(entrega, "88", null)).toBe(1);
    expect(codigoSituacao(entrega, "12", "BAIXA")).toBe(12);
    expect(codigoSituacao(null, "85", "PRE_ENTREGA")).toBe(85);
    expect(codigoSituacao(null, null, null)).toBeNull();
  });
});

describe("dataConclusaoEfetiva (§3.4)", () => {
  const base = { dataEntregaRealizada: null, ocorrEfetivaCodigo: null, ocorrEfetivaData: null };

  it("entrega às 23:59 de Brasília conclui no mesmo dia", () => {
    expect(
      dataConclusaoEfetiva(
        { ...base, dataEntregaRealizada: new Date("2026-11-06T02:59:00Z") },
        BAIXA_FR,
      ),
    ).toBe("2026-11-05");
  });

  it("sem entrega, efetiva de baixa conclui no dia dela; não conclusiva ou sem data, nulo", () => {
    const data = new Date("2026-11-07T12:00:00Z");
    expect(
      dataConclusaoEfetiva({ ...base, ocorrEfetivaCodigo: "12", ocorrEfetivaData: data }, BAIXA_FR),
    ).toBe("2026-11-07");
    expect(
      dataConclusaoEfetiva({ ...base, ocorrEfetivaCodigo: "85", ocorrEfetivaData: data }, BAIXA_FR),
    ).toBeNull();
    expect(dataConclusaoEfetiva({ ...base, ocorrEfetivaCodigo: "1" }, BAIXA_FR)).toBeNull();
  });
});
