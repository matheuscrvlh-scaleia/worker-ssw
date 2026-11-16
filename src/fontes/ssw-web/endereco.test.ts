import { describe, expect, it } from "vitest";

import { enderecoDoSswWeb } from "./endereco";

const PADRAO = "https://sistema.ssw.inf.br";

describe("enderecoDoSswWeb", () => {
  it("usa o endereço da Plataforma, sem a barra do fim", () => {
    expect(enderecoDoSswWeb({ url: "https://tms.ssw.inf.br/" }, PADRAO)).toBe(
      "https://tms.ssw.inf.br",
    );
  });

  it("sem cadastro, vazio ou inválido, fica o do ambiente", () => {
    expect(enderecoDoSswWeb(null, PADRAO)).toBe(PADRAO);
    expect(enderecoDoSswWeb({ url: "  " }, PADRAO)).toBe(PADRAO);
    expect(enderecoDoSswWeb({ url: "tms.ssw.inf.br" }, PADRAO)).toBe(PADRAO);
    expect(enderecoDoSswWeb({ url: "ftp://tms.ssw.inf.br" }, PADRAO)).toBe(PADRAO);
  });
});
