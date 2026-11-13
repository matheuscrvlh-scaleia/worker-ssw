/**
 * BI2 0017 (performance dos entregues): o que cada linha muda no CT-e. Só completa entrega e
 * previsão — nunca cria CT-e e nunca mexe em CT-e em andamento (trava do núcleo, Q25). O SLA
 * (`performance_dias`, `no_prazo`, `responsabilidade_cliente`) vem dos arquivos, não daqui.
 * Especificação: docs/regras/06-ingestao.md §3.15.
 */
import { type DataIso, ehDiaDeSemana, somarDiasCorridos } from "../core/time";

/** Linha do 0017 já lida (sem DATA AUTORIZACAO a linha nem chega aqui). */
export interface Linha0017 {
  numero: string;
  dataEmissao: DataIso;
  dataPrevistaEntrega: DataIso | null;
  dataEntregaRealizada: Date | null;
}

/** Colunas do CT-e que o 0017 lê. */
export interface CtePara0017 {
  dataEmissao: DataIso;
  dataEntregaRealizada: Date | null;
  dataPrevistaEntrega: DataIso | null;
  prazoEntrega: DataIso | null;
  camposSsw: readonly string[];
}

/** Repetida no lote (mesmo número e emissão): vale a última. origem: bi2_0017_aplicar_lote */
export function ultimaPorCte(linhas: readonly Linha0017[]): Linha0017[] {
  const porChave = new Map<string, Linha0017>();
  for (const l of linhas) porChave.set(`${l.numero}|${l.dataEmissao}`, l);
  return [...porChave.values()];
}

/**
 * Passo 1 (fonte `bi2`): entrega e previsão do BI2, mas a coluna que veio dos arquivos do SSW
 * (`campos_ssw`) fica. Sem previsão no BI2, mantém a do CT-e. `null` = nada muda.
 * origem: bi2_0017_aplicar_lote, passo 1 (sistema atual)
 */
export function entregaEPrevisaoDoBi2(
  cte: CtePara0017,
  linha: Linha0017,
): Pick<CtePara0017, "dataEntregaRealizada" | "dataPrevistaEntrega"> | null {
  const doSsw = new Set(cte.camposSsw);
  const entrega = doSsw.has("data_entrega_realizada")
    ? cte.dataEntregaRealizada
    : linha.dataEntregaRealizada;
  const previsao = doSsw.has("data_prevista_entrega")
    ? cte.dataPrevistaEntrega
    : (linha.dataPrevistaEntrega ?? cte.dataPrevistaEntrega);
  if (mesmoInstante(entrega, cte.dataEntregaRealizada) && previsao === cte.dataPrevistaEntrega) {
    return null;
  }
  return { dataEntregaRealizada: entrega, dataPrevistaEntrega: previsao };
}

/**
 * Passo 2 (fonte `bi2_0017_prazo_entregue`): prazo ajustado no SSW depois da entrega. Em CT-e
 * entregue, a previsão do BI2 (não anterior à emissão) troca a previsão; o `prazo_entrega` só
 * acompanha quando era igual à previsão antiga (nulo com nulo conta).
 * origem: bi2_0017_aplicar_lote, passo 2; decisão prazo-ajustado-depois-da-entrega-2026-11-06
 */
export function prazoAjustadoDepoisDaEntrega(
  cte: CtePara0017,
  linha: Linha0017,
): { dataPrevistaEntrega: DataIso; prazoEntrega: DataIso | null; prazoFonte: "bi2" } | null {
  const nova = linha.dataPrevistaEntrega;
  if (cte.dataEntregaRealizada === null || nova === null) return null;
  if (nova < cte.dataEmissao || nova === cte.dataPrevistaEntrega) return null;
  return {
    dataPrevistaEntrega: nova,
    prazoEntrega: cte.prazoEntrega === cte.dataPrevistaEntrega ? nova : cte.prazoEntrega,
    prazoFonte: "bi2",
  };
}

function mesmoInstante(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : a.getTime() === b.getTime();
}

/**
 * Data do arquivo do 0017: `data` = fechamento, conteúdo = entregas de D-1. O SSW não gera o
 * arquivo com conteúdo de sábado/domingo nem o de hoje antes de fechar: 404 aí é "vazio".
 */
export function vazioQuandoNaoEncontrado(dataFechamento: DataIso, hoje: DataIso): boolean {
  return dataFechamento === hoje || !ehDiaDeSemana(somarDiasCorridos(dataFechamento, -1));
}

export const MODOS_DO_0017 = ["cron_continuo", "manual"] as const;
export type Modo0017 = (typeof MODOS_DO_0017)[number];

/**
 * Datas a buscar: a pedida (sem ela: hoje no contínuo, ontem no manual) e mais `lookback` dias
 * para trás (padrão 2 no contínuo, 0 no manual; de 0 a 7).
 * origem: rota bi2-0017 (sistema atual)
 */
export function datasDoCiclo0017(entrada: {
  modo: Modo0017;
  data: DataIso | null;
  lookback: number | null;
  hoje: DataIso;
}): DataIso[] {
  const principal =
    entrada.data ??
    (entrada.modo === "cron_continuo" ? entrada.hoje : somarDiasCorridos(entrada.hoje, -1));
  const padrao = entrada.modo === "cron_continuo" ? 2 : 0;
  const dias = Math.min(7, Math.max(0, Math.trunc(entrada.lookback ?? padrao)));
  return Array.from({ length: dias + 1 }, (_, i) => somarDiasCorridos(principal, -i));
}
