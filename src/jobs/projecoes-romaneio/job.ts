import {
  recalcularProjecoesDoRomaneio,
  reconstruirProjecoesDoRomaneio,
} from "@erp/domain/manifest/projections";
import { JOB_PROJECOES_ROMANEIO } from "@erp/shared/ingestion";
import { z } from "@erp/shared/zod";

import { definirJob } from "../registro";

/** CT-e por lote da reconstrução completa (uma transação por lote). */
export const TAMANHO_DO_LOTE = 500;

const chave = z.object({ sigla: z.string().min(1), numero: z.string().min(1) });

/**
 * Recálculo incremental das projeções do Romaneio (viagens, saídas, romaneio atual, dados
 * 038/455 e conferente) dos CT-e cujas linhas a ingestão acabou de gravar ou de apagar. Sob
 * demanda: a ingestão enfileira com as chaves ao aplicar cada lote 036/306/038/455
 * (`avisarProjecoes` em `@erp/ingestao`) e, no descarte de ciclo, com as linhas apagadas.
 * Substitui o refresh das matviews (Q38).
 */
export const recalcularProjecoesRomaneio = definirJob({
  nome: JOB_PROJECOES_ROMANEIO.nome,
  fila: JOB_PROJECOES_ROMANEIO.fila,
  escopo: "empresa",
  dados: z.object({
    empresaId: z.uuid(),
    chaves: z.array(chave).min(1).max(JOB_PROJECOES_ROMANEIO.maxChaves),
    descartadas: z
      .array(
        chave.extend({
          relatorios: z.array(z.string()),
          romaneios: z.array(z.string()),
          dias: z.array(z.string()),
        }),
      )
      .max(JOB_PROJECOES_ROMANEIO.maxChaves)
      .optional(),
  }),
  agendamento: null,
  async processar({ executar, log }, { chaves, descartadas }) {
    const resumo = await executar(({ projecoesRomaneio }) =>
      recalcularProjecoesDoRomaneio(projecoesRomaneio, chaves, descartadas),
    );
    log.info(resumo, "projeções do romaneio recalculadas");
  },
});

/**
 * Reconstrução completa diária (conciliação, Q38): percorre todo CT-e com linha guardada.
 * CT-e alterado aqui é divergência do incremental e vai para o log como aviso. Agendado só com
 * `AGENDAMENTOS_LIGADOS` (desligado por padrão).
 */
export const reconstruirProjecoesRomaneio = definirJob({
  nome: "projecoes-romaneio-completa",
  fila: JOB_PROJECOES_ROMANEIO.fila,
  escopo: "empresa",
  dados: z.object({ empresaId: z.uuid() }),
  agendamento: "30 2 * * *",
  async processar({ executar, log }) {
    const resumo = await reconstruirProjecoesDoRomaneio(
      (fn) => executar(({ projecoesRomaneio }) => fn(projecoesRomaneio)),
      TAMANHO_DO_LOTE,
    );
    if (resumo.alterados > 0) {
      log.warn(resumo, "reconstrução das projeções do romaneio achou divergência do incremental");
    } else {
      log.info(resumo, "projeções do romaneio conferidas");
    }
  },
});
