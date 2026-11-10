/**
 * Universo do CT-e: o que entra no sistema (data mínima de emissão) e o que fica fora das telas
 * (cancelado no mesmo dia, cópia).
 */
import { CODIGO_CANCELAMENTO } from "./codigos";
import { foraDeQuarentena, type OcorrenciaDoCte } from "./ocorrencia";
import { type DataIso, diaSp } from "./tempo";

/**
 * CT-e emitido antes da data mínima da empresa não é criado (descartado sem erro; não vale para
 * atualização).
 * origem: _trg_ctrcs_data_minima_emissao (sistema atual)
 */
export function abaixoDaDataMinima(emissao: DataIso, dataMinima: DataIso | null): boolean {
  return dataMinima !== null && emissao < dataMinima;
}

/**
 * Tem cancelamento (99) no mesmo dia (Brasília) da emissão. Quarentena fora (Q21 do dono).
 * origem: _is_cancelado_mesmo_dia (sistema atual)
 */
export function canceladoMesmoDia(
  emissao: DataIso,
  ocorrencias: readonly OcorrenciaDoCte[],
): boolean {
  return foraDeQuarentena(ocorrencias).some(
    (o) => o.codigo === CODIGO_CANCELAMENTO && diaSp(o.dataHora) === emissao,
  );
}

/**
 * Fora de todas as telas: cancelado no mesmo dia ou cópia de outro CT-e. Nunca gravado direto:
 * para tirar um CT-e das telas preenche-se `duplicado_de`.
 * origem: _trg_ctrcs_fora_universo (sistema atual)
 */
export function foraDoUniverso(canceladoNoMesmoDia: boolean, duplicadoDe: string | null): boolean {
  return canceladoNoMesmoDia || duplicadoDe !== null;
}
