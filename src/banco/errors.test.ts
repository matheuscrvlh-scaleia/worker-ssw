import { DrizzleQueryError } from "drizzle-orm/errors";
import { describe, expect, it } from "vitest";

import { erroParaLog } from "./errors";

describe("erroParaLog", () => {
  it("tira SQL e parâmetros do erro do Drizzle (mensagem, stack, campos e detail do pg)", () => {
    const doPg = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint: "usuarios_email",
      detail: "Key (email)=(joana@fr.com.br) already exists.",
    });
    const erro = new DrizzleQueryError(
      'insert into "erp"."usuarios" ("email") values ($1)',
      ["joana@fr.com.br"],
      doPg,
    );
    const log = JSON.stringify(erroParaLog(erro));
    expect(log).not.toContain("joana@fr.com.br");
    expect(log).not.toContain("insert into");
    expect(erroParaLog(erro)).toMatchObject({
      type: "DrizzleQueryError",
      cause: { code: "23505", constraint: "usuarios_email" },
    });
  });

  it("erro comum mantém mensagem e stack", () => {
    const r = erroParaLog(new Error("fila fora"));
    expect(r).toMatchObject({ type: "Error", message: "fila fora" });
    expect(r.stack).toContain("at ");
  });
});
