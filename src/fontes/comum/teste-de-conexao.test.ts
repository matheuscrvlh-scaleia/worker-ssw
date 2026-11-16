import { describe, expect, it } from "vitest";

import { resultadoDoBi2 } from "./teste-de-conexao";

describe("resultadoDoBi2", () => {
  it("200 e 404 contam como conectado", () => {
    expect(resultadoDoBi2({ tipo: "ok", texto: "a;b" }).ok).toBe(true);
    expect(resultadoDoBi2({ tipo: "http", status: 404, corpo: "" }).ok).toBe(true);
  });

  it("token recusado, outro HTTP e rede fora falham com a mensagem", () => {
    expect(resultadoDoBi2({ tipo: "http", status: 401, corpo: "" })).toEqual({
      ok: false,
      mensagem: "O BI2 recusou o token (HTTP 401).",
    });
    expect(resultadoDoBi2({ tipo: "http", status: 500, corpo: "boom" }).mensagem).toContain(
      "HTTP 500: boom",
    );
    expect(resultadoDoBi2({ tipo: "falha", mensagem: "timeout" }).ok).toBe(false);
  });
});
