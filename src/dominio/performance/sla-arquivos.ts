import { somarDias } from "@erp/shared/datas";

import { diasUteisEntre } from "../nucleo/prazo";
import { type DataIso, diaSp } from "../nucleo/tempo";
import { compararTexto } from "./primitivas";

/** Primeira emissão que o SLA pelos arquivos recalcula (antes disso vale o BI2). */
const SLA_ARQUIVOS_DESDE_MINIMO = "2025-12-01";

/** Campos que o SLA pelos arquivos grava e marca como vindos do SSW. */
const CAMPOS_DO_SLA = [
  "no_prazo",
  "responsabilidade_cliente",
  "performance_dias",
  "fonte_performance",
] as const;

const FONTE_SLA_ARQUIVOS = "ssw_arquivos";

/** `max(2025-12-01, desde ?? hoje − 60)`. origem: calcular_sla_arquivos (sistema atual) */
export function inicioDoSlaArquivos(hoje: string, desde: string | null): string {
  const pedido = desde ?? somarDias(hoje, -60);
  return pedido > SLA_ARQUIVOS_DESDE_MINIMO ? pedido : SLA_ARQUIVOS_DESDE_MINIMO;
}

/**
 * CT-e entregue (data vinda dos relatórios do SSW) com previsão a partir da emissão: o
 * repositório já filtra esses critérios.
 */
export interface CandidatoSla {
  id: string;
  dataPrevista: DataIso;
  dataEntrega: Date;
  /** Tem ocorrência de pendência do cliente (cadastro da empresa). */
  temPendenciaCliente: boolean;
  performanceDias: number | null;
  noPrazo: boolean | null;
  responsabilidadeCliente: boolean | null;
  fontePerformance: string | null;
  camposSsw: readonly string[];
}

export interface SlaCalculado {
  id: string;
  performanceDias: number;
  noPrazo: boolean;
  responsabilidadeCliente: boolean;
  fontePerformance: string;
  camposSsw: string[];
}

/**
 * Pontualidade pelos arquivos: dias úteis (só feriados nacionais, Q23) entre a previsão e o dia
 * da entrega em Brasília (Q11); no prazo se ≤ 0; atraso com pendência do cliente é responsabilidade do cliente.
 * Devolve nulo quando nada muda (nem valor nem marca de campo do SSW).
 * origem: calcular_sla_arquivos (sistema atual)
 */
export function calcularSlaDoCte(
  c: CandidatoSla,
  feriadosQueContam: ReadonlySet<DataIso>,
): SlaCalculado | null {
  // As duas datas existem: o resultado nunca é nulo aqui.
  const performanceDias =
    diasUteisEntre(c.dataPrevista, diaSp(c.dataEntrega), feriadosQueContam) ?? 0;
  const novo = {
    performanceDias,
    noPrazo: performanceDias <= 0,
    responsabilidadeCliente: performanceDias > 0 && c.temPendenciaCliente,
    fontePerformance: FONTE_SLA_ARQUIVOS,
  };
  const marcasFaltando = CAMPOS_DO_SLA.some((campo) => !c.camposSsw.includes(campo));
  const mudou =
    c.performanceDias !== novo.performanceDias ||
    c.noPrazo !== novo.noPrazo ||
    c.responsabilidadeCliente !== novo.responsabilidadeCliente ||
    c.fontePerformance !== novo.fontePerformance;
  if (!mudou && !marcasFaltando) return null;
  return {
    id: c.id,
    ...novo,
    camposSsw: [...new Set([...c.camposSsw, ...CAMPOS_DO_SLA])].sort(compararTexto),
  };
}
