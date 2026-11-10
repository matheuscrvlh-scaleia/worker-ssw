/**
 * Finalização do CT-e: entregue, baixado (finalizado sem entrega) ou em aberto. Todas as telas
 * decidem pela ocorrência efetiva gravada.
 */
import { CODIGOS_ENTREGA, normCodigoOcorr, type TipoSsw } from "./codigos";
import { type DataIso, diaSp } from "./tempo";

/** origem: _is_entregue (sistema atual) */
export function estaEntregue(dataEntrega: Date | null, codigoEfetivo: string | null): boolean {
  if (dataEntrega !== null) return true;
  const codigo = normCodigoOcorr(codigoEfetivo);
  return codigo !== null && CODIGOS_ENTREGA.has(codigo);
}

/**
 * Sem data de entrega e efetiva de baixa (`codigosBaixa` = cadastro da empresa). O SQL exclui só
 * o 1 — 18/67 nunca são BAIXA.
 * origem: _is_finalizado_sem_entrega (sistema atual)
 */
export function estaFinalizadoSemEntrega(
  dataEntrega: Date | null,
  codigoEfetivo: string | null,
  codigosBaixa: ReadonlySet<number>,
): boolean {
  if (dataEntrega !== null) return false;
  const codigo = normCodigoOcorr(codigoEfetivo);
  return codigo !== null && codigo !== 1 && codigosBaixa.has(codigo);
}

/**
 * Código do seletor "Ocorrência" / gráfico por código: com data de entrega e efetiva que não é
 * ENTREGA/BAIXA (entrega que veio só pelo BI2) conta como 1.
 * origem: codigo_situacao_ctrc (sistema atual)
 */
export function codigoSituacao(
  dataEntrega: Date | null,
  codigoEfetivo: string | null,
  tipoSswDaEfetiva: TipoSsw | null,
): number | null {
  if (dataEntrega !== null && tipoSswDaEfetiva !== "ENTREGA" && tipoSswDaEfetiva !== "BAIXA") {
    return 1;
  }
  return normCodigoOcorr(codigoEfetivo);
}

/**
 * Dia (Brasília) em que o CT-e se encerrou: o da entrega; sem ela, o da efetiva quando é entrega
 * ou baixa.
 * origem: _calc_data_conclusao_efetiva (gatilho, sistema atual)
 */
export function dataConclusaoEfetiva(
  cte: {
    dataEntregaRealizada: Date | null;
    ocorrEfetivaCodigo: string | null;
    ocorrEfetivaData: Date | null;
  },
  codigosBaixa: ReadonlySet<number>,
): DataIso | null {
  if (cte.dataEntregaRealizada !== null) return diaSp(cte.dataEntregaRealizada);
  const encerrado =
    estaEntregue(null, cte.ocorrEfetivaCodigo) ||
    estaFinalizadoSemEntrega(null, cte.ocorrEfetivaCodigo, codigosBaixa);
  return encerrado && cte.ocorrEfetivaData !== null ? diaSp(cte.ocorrEfetivaData) : null;
}
