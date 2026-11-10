import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { cifrarSegredo, decifrarSegredo, lerChavesDeSegredo } from "./segredos";

const chave = () => randomBytes(32).toString("base64");

describe("segredos de integração (AES-256-GCM)", () => {
  const v1 = chave();
  const v2 = chave();

  it("cifra com a chave atual e decifra pela versão gravada na linha", () => {
    const antigas = lerChavesDeSegredo(`1:${v1}`, 1);
    const gravado = cifrarSegredo(antigas, "senha-do-sftp", "empresa-a:sftp");
    expect(gravado.versaoChave).toBe(1);
    expect(gravado.cifrado).not.toContain("senha");

    const rotacionadas = lerChavesDeSegredo(`1:${v1}, 2:${v2}`, 2);
    expect(decifrarSegredo(rotacionadas, gravado, "empresa-a:sftp")).toBe("senha-do-sftp");
    expect(cifrarSegredo(rotacionadas, "x", "c").versaoChave).toBe(2);
  });

  it("não decifra se o segredo for movido para outra integração ou adulterado", () => {
    const chaves = lerChavesDeSegredo(`1:${v1}`, 1);
    const gravado = cifrarSegredo(chaves, "token", "empresa-a:ssw_api");
    expect(() => decifrarSegredo(chaves, gravado, "empresa-b:ssw_api")).toThrow();
    const adulterado = Buffer.from(gravado.cifrado, "base64");
    adulterado[adulterado.length - 1] = (adulterado.at(-1) ?? 0) ^ 1;
    expect(() =>
      decifrarSegredo(
        chaves,
        { ...gravado, cifrado: adulterado.toString("base64") },
        "empresa-a:ssw_api",
      ),
    ).toThrow();
  });

  it("recusa configuração de chave inválida", () => {
    expect(() => lerChavesDeSegredo("1:curta", 1)).toThrow("32 bytes");
    expect(() => lerChavesDeSegredo(`1:${v1}`, 2)).toThrow("atual (2)");
  });
});
