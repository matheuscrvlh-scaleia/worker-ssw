import { describe, expect, it } from "vitest";

import { dataIso, dataIsoComMensagem, listaComTeto, paginacao } from "./query";
import { z } from "./zod";

describe("paginacao", () => {
  const comTeto = z.object(paginacao({ maximo: 500 }));
  const comOpcoes = z.object(paginacao({ opcoes: [25, 50, 100] }));

  it("página 1 e 50 linhas por padrão; o padrão pode mudar", () => {
    expect(comTeto.parse({})).toEqual({ pagina: 1, tamanho: 50 });
    expect(z.object(paginacao({ maximo: 500, padrao: 100 })).parse({})).toEqual({
      pagina: 1,
      tamanho: 100,
    });
  });

  it("aceita número ou texto (query string)", () => {
    expect(comTeto.parse({ pagina: "3", tamanho: "200" })).toEqual({ pagina: 3, tamanho: 200 });
  });

  it("recusa página 0, página absurda, tamanho acima do teto e fora das opções", () => {
    expect(comTeto.safeParse({ pagina: 0 }).success).toBe(false);
    expect(comTeto.safeParse({ pagina: 100_001 }).success).toBe(false);
    expect(comTeto.safeParse({ tamanho: 501 }).success).toBe(false);
    expect(comOpcoes.safeParse({ tamanho: 100 }).success).toBe(true);
    expect(comOpcoes.safeParse({ tamanho: 75 }).success).toBe(false);
  });
});

describe("listaComTeto", () => {
  it("vazia por padrão e no máximo o teto", () => {
    const l = listaComTeto(z.string(), 2);
    expect(l.parse(undefined)).toEqual([]);
    expect(l.safeParse(["a", "b", "c"]).success).toBe(false);
  });
});

describe("dataIso", () => {
  it("mensagem padrão e mensagem própria da tela", () => {
    expect(dataIso.safeParse("01/10/2026").error?.issues[0]?.message).toBe(
      "Data inválida (use AAAA-MM-DD).",
    );
    expect(dataIsoComMensagem("Outra").safeParse("2026-02-30").error?.issues[0]?.message).toBe(
      "Outra",
    );
  });
});
