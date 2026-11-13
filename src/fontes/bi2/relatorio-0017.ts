/**
 * Leitura do CSV do BI2 0017 (recurso `cliente`, código 17): uma linha por CT-e entregue no dia
 * anterior ao fechamento. Especificação: docs/regras/06-ingestao.md §3.15.
 */
import { type Linha0017 } from "@erp/domain/ingestion/bi2-0017";
import { normalizarNumeroCtrc } from "@erp/domain/ingestion/webhook-ssw";

import { type CsvDoBi2 } from "./cliente";

export const CODIGO_DO_0017 = "17";

/** Linha lida do 0017 com o bruto para `bi2_bruto`; `dataEmissao` nula = sem DATA AUTORIZACAO. */
export interface LinhaLida0017 extends Omit<Linha0017, "dataEmissao"> {
  dataEmissao: string | null;
  bruto: Record<string, string>;
}

const COLUNAS = {
  ctrc: ["CTRC", "NUMERO CTRC", "NR CTRC"],
  autorizacao: ["DATA AUTORIZACAO", "DT AUTORIZACAO", "DATA_AUTORIZACAO"],
  previsao: ["DATA PREVENTR", "PREVISAO ENTREGA", "DT PREV ENTREGA"],
  entrega: ["DATA ENTREGA", "DT ENTREGA"],
};

type Valor = CsvDoBi2["linhas"][number]["valor"];

/** Primeira das colunas candidatas presente no cabeçalho. */
function primeira(valor: Valor, candidatas: readonly string[]): string | undefined {
  for (const c of candidatas) {
    const v = valor(c);
    if (v !== undefined) return v;
  }
  return undefined;
}

const DATA_BR = /^(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** "dd/mm/aa[aa]" → "aaaa-mm-dd" (ano de 2 dígitos = 20aa). origem: toIsoDate (BI2) */
export function dataDoBi2Iso(texto: string | undefined): string | null {
  const m = DATA_BR.exec((texto ?? "").trim());
  if (!m) return null;
  const [, dd = "", mm = "", aa = ""] = m;
  return `${aa.length === 2 ? `20${aa}` : aa}-${mm}-${dd}`;
}

/** "dd/mm/aaaa hh:mm[:ss]" em Brasília → instante. origem: toIsoDateTime (BI2) */
export function instanteDoBi2(texto: string | undefined): Date | null {
  const m = DATA_BR.exec((texto ?? "").trim());
  if (!m) return null;
  const [, dd = "", mm = "", aa = "", hh = "00", mi = "00", ss = "00"] = m;
  const data = new Date(`${aa.length === 2 ? `20${aa}` : aa}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
  return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * Linhas do 0017 com número de CTRC (as sem número saem). A previsão é usada como data (a parte
 * do dia do "dd/mm/aaaa hh:mm"). `performance`/`resp cliente` não são lidos: o SLA vem dos
 * arquivos (decisão de 02/10/2026).
 */
export function lerLinhas0017(csv: CsvDoBi2): LinhaLida0017[] {
  const linhas: LinhaLida0017[] = [];
  for (const { valor, bruto } of csv.linhas) {
    const numero = normalizarNumeroCtrc(primeira(valor, COLUNAS.ctrc));
    if (numero === null) continue;
    linhas.push({
      numero,
      dataEmissao: dataDoBi2Iso(primeira(valor, COLUNAS.autorizacao)),
      dataPrevistaEntrega: dataDoBi2Iso(primeira(valor, COLUNAS.previsao)),
      dataEntregaRealizada: instanteDoBi2(primeira(valor, COLUNAS.entrega)),
      bruto,
    });
  }
  return linhas;
}

/** Só as linhas com DATA AUTORIZACAO (sem ela o número pode ser de outro CT-e reciclado). */
export function comAutorizacao(linhas: readonly LinhaLida0017[]): Linha0017[] {
  return linhas.flatMap(({ dataEmissao, ...l }) =>
    dataEmissao === null ? [] : [{ ...l, dataEmissao }],
  );
}
