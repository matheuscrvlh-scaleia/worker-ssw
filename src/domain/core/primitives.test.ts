import { describe, expect, it } from "vitest";

import { CATALOGO_FR } from "../tests/core";
import { codigoNumericoOuNulo, codigosDeBaixa, normCodigoOcorr } from "./codes";
import { formatarCnpjCpf, normalizarNome, padroesTextoFiltro, tipoDocumentoEfetivo } from "./text";
import {
  diaSp,
  difDias,
  hojeSp,
  horaSp,
  inicioDoDiaSp,
  instanteNoFuso,
  relogioNoFuso,
} from "./time";

describe("normCodigoOcorr (§2.1)", () => {
  it.each([
    ["01", 1],
    ["85", 85],
    ["A-18", 18],
    ["1a2", 12],
    ["", null],
    [null, null],
    ["abc", null],
  ])("%j → %j", (entrada, saida) => {
    expect(normCodigoOcorr(entrada)).toBe(saida);
  });
});

describe("codigoNumericoOuNulo (§2.2, Q54: letra vira sem código)", () => {
  it.each([
    ["007", 7],
    ["0", 0],
    ["00", 0],
    ["", null],
    [null, null],
    ["8A", null],
  ])("%j → %j", (entrada, saida) => {
    expect(codigoNumericoOuNulo(entrada)).toBe(saida);
  });
});

describe("códigos de baixa vêm do cadastro da empresa (Q22)", () => {
  it("FR = 12, 36, 61, 77, 92, 93, 94, 99", () => {
    expect([...codigosDeBaixa(CATALOGO_FR)].sort((a, b) => a - b)).toEqual([
      12, 36, 61, 77, 92, 93, 94, 99,
    ]);
  });
});

/**
 * Paridade dos padrões com o `ILIKE ANY` da consulta: a mesma decisão, linha a linha (só no teste;
 * em produção quem casa é o Postgres).
 */
function casaFiltroTexto(valor: string | null, filtro: string | null): boolean {
  if (valor === null || filtro === null) return false;
  return padroesTextoFiltro(filtro).some((p) => ilike(valor, p));
}

/** ILIKE com escape padrão `\`: `%` = qualquer sequência, `_` = um caractere. */
function ilike(valor: string, padrao: string): boolean {
  let regex = "";
  for (let i = 0; i < padrao.length; i++) {
    const ch = padrao.charAt(i);
    if (ch === "\\" && i + 1 < padrao.length) {
      i++;
      regex += escaparRegex(padrao.charAt(i));
    } else if (ch === "%") regex += "[\\s\\S]*";
    else if (ch === "_") regex += "[\\s\\S]";
    else regex += escaparRegex(ch);
  }
  return new RegExp(`^${regex}$`, "iu").test(valor);
}

function escaparRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

describe("filtro de texto com vários valores (§2.3)", () => {
  it.each([
    ["grendene", ["%grendene%"]],
    [" Grendene ", ["%Grendene%"]],
    ["a | b", ["%a%", "%b%"]],
    ["a||b", ["%a%", "%%", "%b%"]],
    ["a|", ["%a%", "%%"]],
  ])("%j → %j", (filtro, padroes) => {
    expect(padroesTextoFiltro(filtro)).toEqual(padroes);
  });

  it("casa como ILIKE: sem caixa, com curinga, sem acento-insensível", () => {
    expect(casaFiltroTexto("GRENDENE S/A", "grendene")).toBe(true);
    expect(casaFiltroTexto("Calçados X", "nike | calçados")).toBe(true);
    expect(casaFiltroTexto("Calcados X", "calçados")).toBe(false);
    expect(casaFiltroTexto("ABC", "a_c")).toBe(true);
    expect(casaFiltroTexto("A.C", "a\\.c")).toBe(true);
    expect(casaFiltroTexto("qualquer", "a||b")).toBe(true);
  });

  it("valor ou filtro nulo não casa", () => {
    expect(casaFiltroTexto(null, "a")).toBe(false);
    expect(casaFiltroTexto("a", null)).toBe(false);
  });
});

describe("normalizarNome (§2.4)", () => {
  it("tira os acentos da lista e põe em maiúsculas", () => {
    expect(normalizarNome(null)).toBe("");
    expect(normalizarNome("João Ação")).toBe("JOAO ACAO");
    expect(normalizarNome("Muñoz")).toBe("MUÑOZ");
  });
});

describe("formatarCnpjCpf (§2.5)", () => {
  it.each([
    ["11222333000181", "11.222.333/0001-81"],
    ["11.222.333/0001-81", "11.222.333/0001-81"],
    ["11222333000199", "11.222.333/0001-99"],
    ["52998224725", "529.982.247-25"],
    ["00052998224725", "529.982.247-25"],
    ["52998224726", "52998224726"],
    ["00052998224726", "00.052.998/2247-26"],
    ["12345", "12345"],
    ["0000", null],
    ["", null],
    [null, null],
    [" 12.abc.345/0001-x ", "12.ABC.345/0001-X"],
  ])("%j → %j", (entrada, saida) => {
    expect(formatarCnpjCpf(entrada)).toBe(saida);
  });
});

describe("tipoDocumentoEfetivo (§2.6)", () => {
  it("455 vence BI2; maiúsculas; vazio é ausente", () => {
    expect(tipoDocumentoEfetivo("SUBC REC FORM LISO", "SUBCONTRATO")).toBe("SUBC REC FORM LISO");
    expect(tipoDocumentoEfetivo("  ", "subcontrato")).toBe("SUBCONTRATO");
    expect(tipoDocumentoEfetivo(null, null)).toBeNull();
  });
});

describe("dia de Brasília (Q11)", () => {
  it("relógio de parede no fuso e o caminho de volta (selo do prazo, Excel)", () => {
    const instante = new Date("2026-11-10T02:30:15Z");
    expect(relogioNoFuso(instante, "America/Sao_Paulo").toISOString()).toBe(
      "2026-11-09T23:30:15.000Z",
    );
    expect(instanteNoFuso("2026-11-09", "23:59:59", "America/Sao_Paulo").toISOString()).toBe(
      "2026-11-10T02:59:59.000Z",
    );
    expect(instanteNoFuso("2026-11-09", "23:59:59", "America/Manaus").toISOString()).toBe(
      "2026-11-10T03:59:59.000Z",
    );
  });

  it("23:59 de Brasília ainda é o mesmo dia; 00:00 UTC não vira o dia seguinte", () => {
    expect(diaSp(new Date("2026-11-06T02:59:00Z"))).toBe("2026-11-05");
    expect(hojeSp(new Date("2026-11-10T23:30:00-03:00"))).toBe("2026-11-10");
  });

  it("meia-noite de Brasília é 03:00 UTC; diferença de dias como date - date", () => {
    expect(inicioDoDiaSp("2026-11-05").toISOString()).toBe("2026-11-05T03:00:00.000Z");
    expect(difDias("2026-11-10", "2026-11-05")).toBe(5);
    expect(difDias("2026-11-05", "2026-11-10")).toBe(-5);
  });

  it("hora de Brasília: 02:30 UTC é 23 h da véspera", () => {
    expect(horaSp(new Date("2026-11-06T02:30:00Z"))).toBe(23);
    expect(horaSp(new Date("2026-11-06T03:00:00Z"))).toBe(0);
  });
});
