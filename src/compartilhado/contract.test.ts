import { describe, expect, it } from "vitest";

import { montarCaminho, usaCorpo } from "./contract";

describe("montarCaminho", () => {
  it("troca os parâmetros e codifica o valor", () => {
    expect(montarCaminho("/api/v1/x/:id/y/:outro", { id: "a b", outro: "7" })).toBe(
      "/api/v1/x/a%20b/y/7",
    );
  });

  it("falha se faltar parâmetro", () => {
    expect(() => montarCaminho("/api/v1/x/:id")).toThrow("id");
  });
});

describe("usaCorpo", () => {
  it("GET e DELETE vão na query; o resto no corpo", () => {
    expect(usaCorpo("GET")).toBe(false);
    expect(usaCorpo("DELETE")).toBe(false);
    expect(usaCorpo("POST")).toBe(true);
    expect(usaCorpo("PUT")).toBe(true);
  });
});
