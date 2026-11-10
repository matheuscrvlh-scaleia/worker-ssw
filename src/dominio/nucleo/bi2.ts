/**
 * Escrita do BI2 no CT-e: o BI2 nunca cria CT-e, nunca altera CT-e em andamento e não sobrescreve
 * coluna que veio dos arquivos do SSW (`campos_ssw`). Regra do usuário de 09/11/2026.
 */
import { estaEntregue, estaFinalizadoSemEntrega } from "./finalizacao";

/** Quem está gravando o CT-e. `outra` = arquivos do SSW, webhook, XML, Admin... */
export type FonteDaEscrita = "bi2" | "bi2_0017_prazo_entregue" | "outra";

/** origem: _trg_ctrcs_bi2_nao_cria (sistema atual) */
export function ehFonteBi2(fonte: FonteDaEscrita): boolean {
  return fonte === "bi2" || fonte === "bi2_0017_prazo_entregue";
}

/** Colunas que a mescla do BI2 lê. */
interface CteParaBi2 {
  dataEntregaRealizada: Date | null;
  /** Instante do cancelamento (XML); CT-e cancelado não conta como em andamento. */
  canceladoEm: Date | null;
  ocorrEfetivaCodigo: string | null;
  /** Nomes das colunas (snake_case, como no banco) cujo valor veio dos arquivos do SSW. */
  camposSsw: readonly string[];
}

/**
 * Mescla a escrita do BI2 num CT-e existente. CT-e em andamento (não cancelado, não entregue,
 * não finalizado) → "descartar" (vale para todo CT-e, com ou sem `campos_ssw` — Q25 do dono).
 * Fonte `bi2` mantém as colunas do SSW (e, com a previsão, a fonte e a base do prazo) e a própria
 * marca; `bi2_0017_prazo_entregue` passa tudo (previsão ajustada depois da entrega, em CT-e
 * encerrado).
 * origem: _trg_ctrcs_bi2_preserva_ssw (sistema atual); decisão prazo-ajustado-depois-da-entrega-2026-11-06
 */
export function mesclarEscritaBi2<T extends CteParaBi2>(
  antigo: T,
  novo: T,
  fonte: FonteDaEscrita,
  codigosBaixa: ReadonlySet<number>,
): T | "descartar" {
  if (!ehFonteBi2(fonte)) return novo;
  const encerrado =
    estaEntregue(antigo.dataEntregaRealizada, antigo.ocorrEfetivaCodigo) ||
    estaFinalizadoSemEntrega(antigo.dataEntregaRealizada, antigo.ocorrEfetivaCodigo, codigosBaixa);
  if (antigo.canceladoEm === null && !encerrado) return "descartar";
  if (fonte === "bi2_0017_prazo_entregue") return novo;
  const manter = new Set(antigo.camposSsw.map(campoDaColuna));
  if (manter.has("dataPrevistaEntrega")) {
    manter.add("prazoFonte");
    manter.add("dataBasePrazo");
  }
  manter.add("camposSsw");
  const resultado = { ...novo };
  for (const campo of manter) if (ehCampoDe(resultado, campo)) resultado[campo] = antigo[campo];
  return resultado;
}

/** `data_prevista_entrega` → `dataPrevistaEntrega`; `ult_ocorr_codigo_0174` → `ultOcorrCodigo0174`. */
export function campoDaColuna(coluna: string): string {
  return coluna.replace(/_([a-z0-9])/g, (_, letra: string) => letra.toUpperCase());
}

function ehCampoDe<T extends object>(objeto: T, campo: string): campo is Extract<keyof T, string> {
  return Object.hasOwn(objeto, campo);
}
