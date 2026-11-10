import { z } from "@erp/shared/zod";

import { definirJob } from "../registro";

export interface RepositorioManutencao {
  /** Retenção da ingestão SSW/BI2 da empresa do contexto; devolve quantas linhas por tabela. */
  apagarIngestaoSswAntiga(limites: LimitesDaIngestaoSsw): Promise<Record<string, number>>;
}

export interface LimitesDaIngestaoSsw {
  /** `ssw_webhook_eventos` e `ssw_sincronizacoes`: 90 dias. */
  registrosSsw: Date;
  /** `bi2_sincronizacoes` e `bi2_bruto`: 400 dias (cobre o reprocesso do ano). */
  bi2: Date;
}

const DIA_MS = 24 * 60 * 60_000;

/**
 * Retenção da ingestão SSW/BI2 (Q49 do dono): eventos do webhook e execuções da SSW API 90 dias;
 * execuções e bruto do BI2 400 dias. Por empresa (o RLS não deixa a Plataforma apagar dado de
 * empresa), todo dia às 03:50.
 */
export const limparIngestaoSsw = definirJob({
  nome: "limpar-ingestao-ssw",
  fila: "manutencao",
  escopo: "empresa",
  dados: z.object({ empresaId: z.uuid() }),
  agendamento: "50 3 * * *",
  async processar({ executar, agora, log }) {
    const hoje = agora().getTime();
    const apagados = await executar(({ manutencao }) =>
      manutencao.apagarIngestaoSswAntiga({
        registrosSsw: new Date(hoje - 90 * DIA_MS),
        bi2: new Date(hoje - 400 * DIA_MS),
      }),
    );
    log.info(apagados, "retenção da ingestão SSW");
    return apagados;
  },
});
