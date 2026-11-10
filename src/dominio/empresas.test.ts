import { describe, expect, it } from "vitest";

import { empresaEmOperacao } from "./empresas";

describe("empresaEmOperacao", () => {
  it("ativa e em implantação operam; suspensa, encerrada e desconhecido não", () => {
    expect(empresaEmOperacao("ativa")).toBe(true);
    expect(empresaEmOperacao("implantacao")).toBe(true);
    expect(empresaEmOperacao("suspensa")).toBe(false);
    expect(empresaEmOperacao("encerrada")).toBe(false);
    expect(empresaEmOperacao("")).toBe(false);
  });
});
