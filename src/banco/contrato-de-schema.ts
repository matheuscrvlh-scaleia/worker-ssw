/**
 * Contrato de schema entre o ERP (dono do schema `erp`) e o worker-ssw: no boot, cada tabela e
 * coluna da cópia Drizzle (`./schema`) tem de existir no banco com o tipo esperado. Faltou ou
 * mudou = o worker-ssw não sobe, com a lista do que divergiu (ADR 0012 do ERP).
 *
 * Lê `information_schema.columns`, que só mostra as colunas em que o papel tem algum privilégio:
 * coluna sem GRANT para o `erp_worker` aparece aqui como ausente.
 */
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";

import * as schema from "./schema";

export interface ColunaEsperada {
  tabela: string;
  coluna: string;
  /** Tipo como o Postgres escreve (`text`, `numeric(12,3)`, `text[]`, nome do enum). */
  tipo: string;
}

/** Uma linha de `information_schema.columns` do schema `erp`. */
export interface ColunaDoBanco {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  character_maximum_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

/** `numeric(12, 3)` → `numeric(12,3)`; `erp.prazo_origem` → `prazo_origem`. */
const normalizar = (tipo: string) =>
  tipo
    .toLowerCase()
    .replace(/,\s+/g, ",")
    .replace(/^"?erp"?\./, "")
    .replaceAll('"', "");

/** Colunas que o worker-ssw espera, tiradas das tabelas Drizzle copiadas. */
export function colunasEsperadas(): ColunaEsperada[] {
  const valores: unknown[] = Object.values(schema);
  return valores
    .flatMap((v) => (is(v, PgTable) ? [v] : []))
    .flatMap((tabela) => {
      const config = getTableConfig(tabela);
      return config.columns.map((c) => ({
        tabela: config.name,
        coluna: c.name,
        tipo: normalizar(c.getSQLType()),
      }));
    })
    .sort((a, b) => `${a.tabela}.${a.coluna}`.localeCompare(`${b.tabela}.${b.coluna}`));
}

export function tipoDoBanco(c: ColunaDoBanco): string {
  if (c.data_type === "ARRAY") return `${c.udt_name.replace(/^_/, "")}[]`;
  if (c.data_type === "USER-DEFINED") return c.udt_name;
  if (c.data_type === "character" && c.character_maximum_length !== null) {
    return `char(${c.character_maximum_length})`;
  }
  if (c.data_type === "numeric" && c.numeric_precision !== null) {
    return `numeric(${c.numeric_precision},${c.numeric_scale ?? 0})`;
  }
  return c.data_type;
}

/** Divergências entre o esperado e o banco, uma por linha (vazio = contrato cumprido). */
export function conferirColunas(
  esperadas: readonly ColunaEsperada[],
  doBanco: readonly ColunaDoBanco[],
): string[] {
  const porNome = new Map(doBanco.map((c) => [`${c.table_name}.${c.column_name}`, c]));
  return esperadas.flatMap(({ tabela, coluna, tipo }) => {
    const achada = porNome.get(`${tabela}.${coluna}`);
    if (!achada) return [`erp.${tabela}.${coluna}: ausente (ou sem GRANT para o papel)`];
    const real = tipoDoBanco(achada);
    return real === tipo ? [] : [`erp.${tabela}.${coluna}: tipo ${real}, esperado ${tipo}`];
  });
}

export const CONSULTA_DAS_COLUNAS = `
  select table_name, column_name, data_type, udt_name, character_maximum_length,
         numeric_precision, numeric_scale
  from information_schema.columns
  where table_schema = 'erp'`;

export class SchemaDivergente extends Error {
  constructor(readonly divergencias: readonly string[]) {
    super(
      `O schema erp do banco não é o que o worker-ssw espera (migration do ERP pendente ou ` +
        `GRANT faltando):\n${divergencias.map((d) => `  - ${d}`).join("\n")}`,
    );
    this.name = "SchemaDivergente";
  }
}

/** Confere no boot; lança `SchemaDivergente` com a lista do que falta. */
export async function conferirSchema(
  consultar: (sql: string) => Promise<ColunaDoBanco[]>,
): Promise<void> {
  const divergencias = conferirColunas(colunasEsperadas(), await consultar(CONSULTA_DAS_COLUNAS));
  if (divergencias.length > 0) throw new SchemaDivergente(divergencias);
}
