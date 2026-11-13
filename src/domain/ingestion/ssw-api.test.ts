import { describe, expect, it } from "vitest";

import {
  normalizarCredenciaisSsw,
  precisaRenovarToken,
  previaDoToken,
  saudeDaIntegracaoSsw,
  tipoDaFalhaSsw,
} from "./ssw-api";

const agora = new Date("2026-11-10T12:00:00Z");
const horasAtras = (h: number) => new Date(agora.getTime() - h * 3_600_000);

describe("saúde da SSW API (faixa do layout)", () => {
  it("integração desligada não acende a faixa", () => {
    expect(
      saudeDaIntegracaoSsw({ ativa: false, configurado: false, tokenGeradoEm: null, agora }),
    ).toMatchObject({ saudavel: true, motivo: "ok" });
  });

  it("sem credenciais, sem token, token vencido (4 h) e ok", () => {
    const base = { ativa: true, agora };
    expect(
      saudeDaIntegracaoSsw({ ...base, configurado: false, tokenGeradoEm: null }),
    ).toMatchObject({ saudavel: false, motivo: "sem_credenciais" });
    expect(saudeDaIntegracaoSsw({ ...base, configurado: true, tokenGeradoEm: null })).toMatchObject(
      {
        motivo: "sem_token",
      },
    );
    expect(
      saudeDaIntegracaoSsw({ ...base, configurado: true, tokenGeradoEm: horasAtras(4) }),
    ).toMatchObject({ saudavel: false, motivo: "token_expirado" });
    expect(
      saudeDaIntegracaoSsw({ ...base, configurado: true, tokenGeradoEm: horasAtras(3.9) }),
    ).toMatchObject({ saudavel: true, tokenValido: true, motivo: "ok" });
  });
});

describe("renovação do token", () => {
  it("renova sem token ou com 90 min ou menos de validade", () => {
    expect(precisaRenovarToken(null, agora)).toBe(true);
    expect(precisaRenovarToken(horasAtras(2), agora)).toBe(false);
    expect(precisaRenovarToken(horasAtras(2.5), agora)).toBe(true);
  });

  it("normaliza domínio e usuário sem acento; CNPJ com 14 dígitos", () => {
    expect(
      normalizarCredenciaisSsw({
        dominio: " frt ",
        usuario: "joão",
        senha: "x",
        cnpjEdi: "12.345.678/0001-90",
      }),
    ).toEqual({
      tipo: "ok",
      credenciais: { dominio: "FRT", usuario: "joao", senha: "x", cnpjEdi: "12345678000190" },
    });
    expect(
      normalizarCredenciaisSsw({ dominio: "FRT", usuario: "u", senha: "x", cnpjEdi: "123" }),
    ).toEqual({ tipo: "erro", mensagem: "CNPJ EDI inválido: esperado 14 dígitos, recebido 3." });
  });

  it("classifica a falha do generateToken", () => {
    expect(tipoDaFalhaSsw(502, "")).toBe("upstream_unavailable");
    expect(tipoDaFalhaSsw(200, "error code: 522")).toBe("upstream_unavailable");
    expect(tipoDaFalhaSsw(null, "")).toBe("upstream_unavailable");
    expect(tipoDaFalhaSsw(200, "Cliente sem acesso ao SSW2173")).toBe("permission_denied");
    expect(tipoDaFalhaSsw(401, "senha inválida")).toBe("auth_failed");
  });

  it("prévia nunca mostra o token inteiro", () => {
    expect(previaDoToken("abcdefghijkl")).toBe("abcd…ijkl");
    expect(previaDoToken("curto")).toBe("••••");
  });
});
