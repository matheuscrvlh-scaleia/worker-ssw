import { describe, expect, it } from "vitest";

import {
  diaDaSemana,
  diferencaEmDias,
  ehDataIso,
  hojeNoFuso,
  montarDataIso,
  somarAnos,
  somarDias,
} from "./dates";

describe("datas ISO", () => {
  it("valida data de calendário de verdade", () => {
    expect(ehDataIso("2026-02-28")).toBe(true);
    expect(ehDataIso("2026-02-30")).toBe(false);
    expect(ehDataIso("2026-2-3")).toBe(false);
  });

  it("hoje no fuso da empresa vira o dia certo perto da meia-noite UTC", () => {
    const quaseMeiaNoiteEmSp = new Date("2026-11-11T02:30:00Z");
    expect(hojeNoFuso("America/Sao_Paulo", quaseMeiaNoiteEmSp)).toBe("2026-11-10");
    expect(hojeNoFuso("UTC", quaseMeiaNoiteEmSp)).toBe("2026-11-11");
  });

  it("29/02 somado um ano cai em 01/03 (igual ao sistema atual)", () => {
    expect(somarAnos("2028-02-29", 1)).toBe("2029-03-01");
    expect(somarAnos("2026-11-20", 2)).toBe("2028-11-20");
  });

  it("soma dias, mede diferença e dá o dia da semana", () => {
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(diferencaEmDias("2026-11-10", "2026-11-20")).toBe(10);
    expect(diferencaEmDias("2026-11-20", "2026-11-10")).toBe(-10);
    expect(diaDaSemana("2026-11-10")).toBe(2);
    expect(montarDataIso(2026, 1, 1)).toBe("2026-01-01");
  });
});
