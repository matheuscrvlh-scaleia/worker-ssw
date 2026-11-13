import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { ehTempoEsgotado, sqlDoContexto } from "./client";

describe("contexto da transação", () => {
  it("vai por parâmetro, nunca concatenado no SQL", () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      sqlDoContexto({ empresaId: "e1'; drop table x; --", usuarioId: "u1", plataforma: true }),
    );
    expect(sql).not.toContain("drop table");
    expect(sql).toContain("set_config('app.empresa_id', $1, true)");
    expect(params).toEqual(["e1'; drop table x; --", "u1", "on"]);
  });

  it("sem empresa e sem usuário grava vazio (as políticas tratam como nulo)", () => {
    const { params } = new PgDialect().sqlToQuery(
      sqlDoContexto({ empresaId: null, usuarioId: null, plataforma: false }),
    );
    expect(params).toEqual(["", "", "off"]);
  });

  it("rota pública do ranking: o hash do token vai como parâmetro a mais", () => {
    const { sql, params } = new PgDialect().sqlToQuery(
      sqlDoContexto({ empresaId: null, usuarioId: null, plataforma: false, tokenPublicoHash: "h" }),
    );
    expect(sql).toContain("set_config('app.token_publico_hash', $4, true)");
    expect(params).toEqual(["", "", "off", "h"]);
  });
});

describe("ehTempoEsgotado", () => {
  it("reconhece o 57014 direto ou embrulhado", () => {
    expect(ehTempoEsgotado({ code: "57014" })).toBe(true);
    expect(ehTempoEsgotado(new Error("x", { cause: { code: "57014" } }))).toBe(true);
    expect(ehTempoEsgotado({ code: "23505" })).toBe(false);
    expect(ehTempoEsgotado("57014")).toBe(false);
  });
});
