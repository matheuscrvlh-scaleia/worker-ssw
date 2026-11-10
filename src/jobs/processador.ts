import { type ContextoBanco, erroParaLog } from "@erp/db";
import { ErroDeNegocio } from "@erp/dominio/erros";
import { z } from "@erp/shared/zod";
import { UnrecoverableError } from "bullmq";
import { type Logger } from "pino";

import { type DefinicaoDeJob, type ExecutorDoWorker } from "./registro";

const dadosDeEmpresa = z.object({ empresaId: z.uuid() });

/**
 * O motivo da falha fica no Redis e o ERP o mostra ao operador (HTTP interno): só mensagem pensada
 * para ele. O detalhe (SQL, pilha) vai só para o log.
 */
export const MENSAGEM_DE_FALHA =
  "Falha ao executar o job. Tente de novo; se persistir, avise o suporte.";

export interface DependenciasDoProcessador {
  jobs: readonly DefinicaoDeJob[];
  executar: ExecutorDoWorker;
  log: Logger;
  agora: () => Date;
}

/** Contexto do banco do job: igual ao da API do ERP (RLS pela empresa) ou o da Plataforma. */
function contextoDoJob(job: DefinicaoDeJob, dados: unknown): ContextoBanco {
  if (job.escopo === "plataforma") return { empresaId: null, usuarioId: null, plataforma: true };
  return { empresaId: dadosDeEmpresa.parse(dados).empresaId, usuarioId: null, plataforma: false };
}

/**
 * Função entregue ao Worker do BullMQ: acha a definição pelo nome, valida os dados e roda no
 * contexto certo. Job desconhecido ou dado inválido não adianta repetir (UnrecoverableError).
 */
export function criarProcessador(deps: DependenciasDoProcessador) {
  const porNome = new Map(deps.jobs.map((j) => [j.nome, j]));
  return async (job: { id?: string | undefined; name: string; data: unknown }) => {
    const definicao = porNome.get(job.name);
    if (!definicao) throw new UnrecoverableError(`Job desconhecido: ${job.name}.`);
    let dados: unknown;
    let contexto: ContextoBanco;
    try {
      dados = definicao.dados.parse(job.data);
      contexto = contextoDoJob(definicao, job.data);
    } catch (erro) {
      deps.log.warn({ job: job.name, jobId: job.id, err: erroParaLog(erro) }, "dados inválidos");
      throw new UnrecoverableError(`Dados inválidos para o job ${job.name}.`);
    }
    const log = deps.log.child({ job: job.name, jobId: job.id, empresaId: contexto.empresaId });
    try {
      return await definicao.processar(
        {
          executar: (fn) => deps.executar(contexto, fn),
          empresaId: contexto.empresaId,
          log,
          agora: deps.agora,
        },
        dados,
      );
    } catch (erro) {
      // Mensagem escrita para o operador passa como está; o resto vira a genérica.
      if (erro instanceof UnrecoverableError || erro instanceof ErroDeNegocio) throw erro;
      log.error({ err: erroParaLog(erro) }, "erro no job");
      throw new Error(MENSAGEM_DE_FALHA, { cause: erro });
    }
  };
}
