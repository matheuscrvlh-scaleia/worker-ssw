import { describe, expect, it } from "vitest";

import { type IntegracaoGravada } from "../comum/integracao";
import { configuracaoSswWeb, siglasDaLista } from "./parametros";

const integracao = (parametros: Record<string, unknown>, ativo = true): IntegracaoGravada => ({
  ativo,
  parametros,
  segredo: null,
  dominioSswDaEmpresa: "FRT",
});

const completa = {
  cpf: "123.456.789-01",
  usuario: "robo",
  unidades_038: ["ara", "CAP", "ARA"],
  unidades_038_so_com_dados: "GDR, cap, COU",
  unidades_050: "ARA,CAP",
};

describe("configuração do SSW web", () => {
  it("lê a lista como a tela grava (array ou texto), em maiúsculas e sem repetir", () => {
    expect(siglasDaLista(["ara", " CAP ", "ARA", 3])).toEqual(["ARA", "CAP"]);
    expect(siglasDaLista("gdr, ,COU")).toEqual(["GDR", "COU"]);
    expect(siglasDaLista(undefined)).toEqual([]);
  });

  it("usa o domínio da empresa e MTZ quando vazios; CPF só com dígitos", () => {
    const r = configuracaoSswWeb(integracao(completa), "senha");
    expect(r).toEqual({
      ok: true,
      config: {
        dominio: "FRT",
        cpf: "12345678901",
        usuario: "robo",
        senha: "senha",
        matriz: "MTZ",
        unidades038: ["ARA", "CAP"],
        // CAP já está no 038 de sempre: não entra duas vezes
        unidades038SoComDados: ["GDR", "COU"],
        unidades050: ["ARA", "CAP"],
      },
    });
  });

  it("recusa desligada, incompleta ou com unidade inválida, dizendo o que falta", () => {
    expect(configuracaoSswWeb(integracao(completa, false), "s")).toMatchObject({ ok: false });
    expect(configuracaoSswWeb(null, "s")).toMatchObject({ ok: false });
    expect(configuracaoSswWeb(integracao({ usuario: "robo", cpf: "123" }), null)).toEqual({
      ok: false,
      mensagem: "Integração SSW web incompleta: falta CPF (11 dígitos), senha.",
    });
    expect(
      configuracaoSswWeb(integracao({ ...completa, unidades_050: "ARA, CAPITAL" }), "s"),
    ).toEqual({ ok: false, mensagem: "Integração SSW web com unidade inválida: CAPITAL." });
  });
});
