import { feriadosQueContamNosDiasUteis } from "@erp/dominio/nucleo/prazo";
import { type DataIso, hojeSp } from "@erp/dominio/nucleo/tempo";
import {
  calcularSlaDoCte,
  type CandidatoSla,
  inicioDoSlaArquivos,
  type SlaCalculado,
} from "@erp/dominio/performance/sla-arquivos";
import { ehDataIso } from "@erp/shared/datas";
import { filaDoJob } from "@erp/shared/ingestao";
import { z } from "@erp/shared/zod";

import { definirJob } from "../registro";

export interface RepositorioSlaArquivos {
  /** Feriados que a empresa enxerga (nacionais e os dela), com o tipo. */
  feriados(): Promise<{ data: DataIso; tipo: string }[]>;
  /**
   * CT-e da empresa emitidos desde `desde`, entregues (data vinda dos relatórios do SSW) e com
   * previsão a partir da emissão.
   */
  candidatos(empresaId: string, desde: DataIso): Promise<CandidatoSla[]>;
  /** Grava os novos valores e marcas de `campos_ssw`, com `atualizado_em = agora`. */
  gravar(alterados: readonly SlaCalculado[], agora: Date): Promise<void>;
}

export interface ResultadoSlaArquivos {
  desde: DataIso;
  candidatos: number;
  alterados: number;
}

/**
 * Pontualidade pelos arquivos do SSW: recalcula `performance_dias`, `no_prazo` e
 * `responsabilidade_cliente` dos CT-e entregues desde `desde` (padrão: 60 dias) e grava só o que
 * mudou. origem: calcular_sla_arquivos (sistema atual)
 */
export async function calcularSlaArquivos(
  repo: RepositorioSlaArquivos,
  empresaId: string,
  agora: Date,
  desdePedido: DataIso | null,
): Promise<ResultadoSlaArquivos> {
  const desde = inicioDoSlaArquivos(hojeSp(agora), desdePedido);
  const feriados = feriadosQueContamNosDiasUteis(await repo.feriados());
  const candidatos = await repo.candidatos(empresaId, desde);
  const alterados = candidatos.flatMap((c) => calcularSlaDoCte(c, feriados) ?? []);
  if (alterados.length > 0) await repo.gravar(alterados, agora);
  return { desde, candidatos: candidatos.length, alterados: alterados.length };
}

/** Por empresa, logo depois da unidade pelo 455 (mesmo horário do cron de hoje). */
export const slaPelosArquivos = definirJob({
  nome: "sla-arquivos",
  fila: filaDoJob("sla-arquivos"),
  escopo: "empresa",
  dados: z.object({
    empresaId: z.uuid(),
    desde: z.string().refine(ehDataIso, "Data inválida (use AAAA-MM-DD).").nullish(),
  }),
  // Horário no catálogo de ingestão (8,38 * * * *): quem dispara por empresa é o despachante.
  agendamento: null,
  async processar({ executar, agora, log }, dados) {
    const resultado = await executar(({ slaArquivos }) =>
      calcularSlaArquivos(slaArquivos, dados.empresaId, agora(), dados.desde ?? null),
    );
    log.info(resultado, "SLA pelos arquivos recalculado");
  },
});
