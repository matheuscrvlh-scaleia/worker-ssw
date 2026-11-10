import { describe, expect, it } from "vitest";

import {
  cidadeDaFilial,
  cnpjsPropriosDaEmpresa,
  filiaisProprias,
  unidadeResponsavel,
} from "./cadastros";
import { CONFIGURACAO_PADRAO, lerConfiguracaoDoNucleo } from "./configuracao";
import { type EscopoDoUsuario, podeVerCte, podeVerTudo } from "./escopo";

const FILIAIS = [
  { sigla: "RIO", cidade: "RIO DE JANEIRO", uf: "RJ", propria: true },
  { sigla: "CAP", cidade: "CAMPINAS", uf: null, propria: true },
  { sigla: "SEM", cidade: null, uf: "SP", propria: false },
];

describe("cidade da filial (§10.1)", () => {
  const atual = { unidadeCidade: "X", unidadeUf: "Y" };
  it("sigla sem caixa/espaço; UF nula também sobrescreve", () => {
    expect(cidadeDaFilial({ filial: " cap ", ...atual }, FILIAIS)).toEqual({
      unidadeCidade: "CAMPINAS",
      unidadeUf: null,
    });
  });
  it("filial sem cidade, inexistente ou vazia mantém o que veio", () => {
    expect(cidadeDaFilial({ filial: "SEM", ...atual }, FILIAIS)).toEqual(atual);
    expect(cidadeDaFilial({ filial: "XYZ", ...atual }, FILIAIS)).toEqual(atual);
    expect(cidadeDaFilial({ filial: "  ", ...atual }, FILIAIS)).toEqual(atual);
    expect(cidadeDaFilial({ filial: null, ...atual }, FILIAIS)).toEqual(atual);
  });
});

describe("filiais próprias e CNPJs próprios (§10.2, §10.3)", () => {
  it("siglas próprias ordenadas", () => {
    expect(filiaisProprias(FILIAIS)).toEqual(["CAP", "RIO"]);
    expect(filiaisProprias([])).toEqual([]);
  });
  it("CNPJs só dígitos, distintos, sem vazios", () => {
    expect(
      cnpjsPropriosDaEmpresa("11.222.333/0001-81", ["11222333000181", "", "44.555.666/0001-00"]),
    ).toEqual(["11222333000181", "44555666000100"]);
    expect(cnpjsPropriosDaEmpresa(null, [])).toEqual([]);
  });
});

describe("escopo de visibilidade (§10.4, Q26)", () => {
  const usuario = (extra: Partial<EscopoDoUsuario> = {}): EscopoDoUsuario => ({
    papel: "operador",
    adminPlataforma: false,
    unidadeId: null,
    equipesAtivas: [],
    ...extra,
  });
  const cteDaUnidade = { unidadeId: "u1", equipeId: "e1" };

  it("sem unidade nem equipe vê tudo (hoje ninguém está restrito)", () => {
    expect(podeVerTudo(usuario())).toBe(true);
    expect(podeVerCte(usuario(), cteDaUnidade)).toBe(true);
  });
  it("admin, super admin, gestor e admin da Plataforma veem tudo mesmo com escopo", () => {
    for (const papel of ["admin", "super_admin", "gestor"]) {
      expect(podeVerTudo(usuario({ papel, unidadeId: "u9" }))).toBe(true);
    }
    expect(podeVerTudo(usuario({ adminPlataforma: true, unidadeId: "u9" }))).toBe(true);
  });
  it("com escopo: só a própria unidade ou equipe ativa", () => {
    expect(podeVerCte(usuario({ unidadeId: "u1" }), cteDaUnidade)).toBe(true);
    expect(podeVerCte(usuario({ unidadeId: "u2" }), cteDaUnidade)).toBe(false);
    expect(podeVerCte(usuario({ equipesAtivas: ["e1"] }), cteDaUnidade)).toBe(true);
    expect(
      podeVerCte(usuario({ equipesAtivas: ["e2"] }), { unidadeId: null, equipeId: null }),
    ).toBe(false);
  });
});

describe("configuração do núcleo (§5.3, §7.1, Q48)", () => {
  it("ausente ou vazia vale o padrão da FR", () => {
    expect(lerConfiguracaoDoNucleo(new Map())).toEqual(CONFIGURACAO_PADRAO);
    expect(lerConfiguracaoDoNucleo(new Map([["alerta_dias_sem_movimento", " "]]))).toEqual(
      CONFIGURACAO_PADRAO,
    );
  });
  it("lê os valores da empresa", () => {
    expect(
      lerConfiguracaoDoNucleo(
        new Map([
          ["alerta_dias_sem_movimento", "5"],
          ["ctrc_data_minima_emissao", "2026-09-01"],
          ["prazo_padrao_dias", "3"],
          ["raiz_cnpj_troca", "12345678"],
        ]),
      ),
    ).toEqual({
      limiteSemMovimento: 5,
      dataMinimaEmissao: "2026-09-01",
      prazoPadraoDias: 3,
      raizCnpjTroca: "12345678",
    });
  });
});

describe("unidadeResponsavel", () => {
  const proprias = new Set(["RIO", "SPO"]);
  const cte = { unidadeDestino: "RIO", unidadeAtual: "SPO", filial: "CAP" };

  it("destino próprio, senão atual própria, senão a filial de emissão", () => {
    expect(unidadeResponsavel(proprias, cte)).toBe("RIO");
    expect(unidadeResponsavel(proprias, { ...cte, unidadeDestino: "BHZ" })).toBe("SPO");
    expect(unidadeResponsavel(proprias, { ...cte, unidadeDestino: null, unidadeAtual: null })).toBe(
      "CAP",
    );
  });
});
