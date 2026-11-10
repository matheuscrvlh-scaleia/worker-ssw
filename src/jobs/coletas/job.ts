import { importarRelatorio050 } from "@erp/dominio/coletas/gravacao-050";
import { ErroDeNegocio } from "@erp/dominio/erros";
import { JOB_COLETAS_050 } from "@erp/shared/ingestao";
import { z } from "@erp/shared/zod";
import { UnrecoverableError } from "bullmq";

import { definirJob } from "../registro";

/**
 * Relatório 050 (coletas) que chegou pelo FTP: a recepção da ingestão registra o arquivo e
 * enfileira o conteúdo; aqui ele é gravado em `coletas` com o mesmo caso de uso da importação da
 * tela. Fora do ciclo de aplicação; idempotente (relatório mais velho não sobrescreve).
 * origem: importar-050.server.ts + importar_coletas_050 (sistema atual)
 */
export const importarColetas050 = definirJob({
  nome: JOB_COLETAS_050.nome,
  fila: JOB_COLETAS_050.fila,
  escopo: "empresa",
  dados: z.object({ empresaId: z.uuid(), nome: z.string().min(1), conteudo: z.string().min(1) }),
  agendamento: null,
  async processar({ executar, empresaId, log, agora }, { nome, conteudo }) {
    if (empresaId === null) throw new UnrecoverableError("050 sem empresa.");
    try {
      const r = await executar(({ coletas050 }) =>
        importarRelatorio050(coletas050, empresaId, conteudo, nome, agora()),
      );
      const resumo = {
        arquivo: nome,
        lidas: r.lidas,
        gravadas: r.gravadas,
        ignoradas: r.ignoradas,
      };
      log.info(
        resumo,
        `${String(r.lidas)} coleta(s) lida(s), ${String(r.ignoradas)} já atualizada(s)`,
      );
      return resumo;
    } catch (e) {
      // Arquivo que não é o 050 (ou sem coleta): repetir não muda nada.
      if (e instanceof ErroDeNegocio) throw new UnrecoverableError(`${nome}: ${e.message}`);
      throw e;
    }
  },
});
