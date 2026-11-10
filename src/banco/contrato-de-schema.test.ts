import { describe, expect, it } from "vitest";

import {
  type ColunaDoBanco,
  colunasEsperadas,
  conferirColunas,
  conferirSchema,
  SchemaDivergente,
  tipoDoBanco,
} from "./contrato-de-schema";

/** Linha de `information_schema.columns` que o Postgres devolveria para o tipo esperado. */
function linhaDoBanco(tabela: string, coluna: string, tipo: string): ColunaDoBanco {
  const base = {
    table_name: tabela,
    column_name: coluna,
    udt_name: tipo,
    character_maximum_length: null,
    numeric_precision: null,
    numeric_scale: null,
  };
  const numerico = /^numeric\((\d+),(\d+)\)$/.exec(tipo);
  if (numerico) {
    return {
      ...base,
      data_type: "numeric",
      numeric_precision: Number(numerico[1]),
      numeric_scale: Number(numerico[2]),
    };
  }
  const caractere = /^char\((\d+)\)$/.exec(tipo);
  if (caractere) {
    return { ...base, data_type: "character", character_maximum_length: Number(caractere[1]) };
  }
  if (tipo.endsWith("[]"))
    return { ...base, data_type: "ARRAY", udt_name: `_${tipo.slice(0, -2)}` };
  const nativos = [
    "text",
    "jsonb",
    "uuid",
    "timestamp with time zone",
    "bigint",
    "date",
    "integer",
    "boolean",
    "smallint",
  ];
  return { ...base, data_type: nativos.includes(tipo) ? tipo : "USER-DEFINED" };
}

const banco = () => colunasEsperadas().map((c) => linhaDoBanco(c.tabela, c.coluna, c.tipo));

describe("contrato de schema", () => {
  it("espera as tabelas e colunas que o worker-ssw usa, com o tipo do Postgres", () => {
    const esperadas = colunasEsperadas();
    const tabelas = new Set(esperadas.map((c) => c.tabela));
    expect(tabelas).toContain("ctes");
    expect(tabelas).toContain("ssw_webhook_eventos");
    expect(tabelas).toContain("romaneio_conferente_cte");
    expect(tabelas).not.toContain("usuarios");
    expect(esperadas).toContainEqual({ tabela: "ctes", coluna: "sigla", tipo: "text" });
    expect(esperadas).toContainEqual({ tabela: "ctes", coluna: "peso", tipo: "numeric(12,3)" });
    expect(esperadas).toContainEqual({ tabela: "ctes", coluna: "campos_ssw", tipo: "text[]" });
    expect(esperadas).toContainEqual({
      tabela: "ctes",
      coluna: "prazo_origem",
      tipo: "prazo_origem",
    });
  });

  it("banco igual ao esperado: nenhuma divergência", () => {
    expect(conferirColunas(colunasEsperadas(), banco())).toEqual([]);
  });

  it("coluna ausente (ou sem GRANT) e tipo trocado aparecem na lista", () => {
    const linhas = banco()
      .filter((c) => !(c.table_name === "ctes" && c.column_name === "sigla"))
      .map((c) =>
        c.table_name === "ocorrencias" && c.column_name === "codigo"
          ? { ...c, data_type: "integer", udt_name: "int4" }
          : c,
      );
    expect(conferirColunas(colunasEsperadas(), linhas)).toEqual([
      "erp.ctes.sigla: ausente (ou sem GRANT para o papel)",
      "erp.ocorrencias.codigo: tipo integer, esperado smallint",
    ]);
  });

  it("lê os tipos do information_schema", () => {
    const linha = linhaDoBanco("t", "c", "text");
    expect(tipoDoBanco({ ...linha, data_type: "ARRAY", udt_name: "_text" })).toBe("text[]");
    expect(tipoDoBanco({ ...linha, data_type: "USER-DEFINED", udt_name: "tipo_ssw" })).toBe(
      "tipo_ssw",
    );
    expect(
      tipoDoBanco({ ...linha, data_type: "numeric", numeric_precision: 14, numeric_scale: 2 }),
    ).toBe("numeric(14,2)");
  });

  it("no boot: divergência impede a subida com a lista em português", async () => {
    await expect(conferirSchema(() => Promise.resolve(banco()))).resolves.toBeUndefined();
    const erro = await conferirSchema(() => Promise.resolve([])).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(SchemaDivergente);
    expect(String(erro)).toContain("erp.ctes.sigla: ausente");
  });
});
