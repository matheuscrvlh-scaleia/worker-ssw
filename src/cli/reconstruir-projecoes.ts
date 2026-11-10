/**
 * `reconstruir-projecoes`: refaz as projeções do Romaneio (viagens, saídas, romaneio atual, dados
 * 038/455 e conferente) a partir das linhas guardadas da ingestão. Usado na virada (antes era o
 * migrador do ERP) e quando se desconfia de divergência. Roda na hora, sem fila:
 *
 *   node dist/main.js reconstruir-projecoes --empresa <uuid>
 *   node dist/main.js reconstruir-projecoes --todas
 */
import { reconstruirProjecoesDoRomaneio } from "@erp/dominio/romaneio/projecoes";
import { type Logger } from "pino";

import { TAMANHO_DO_LOTE } from "../jobs/projecoes-romaneio/job";
import { type ExecutorDoWorker } from "../jobs/registro";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlvoDaReconstrucao = { empresaId: string } | "todas";

/** Argumentos depois do nome do comando; `null` = uso errado. */
export function lerAlvo(argumentos: readonly string[]): AlvoDaReconstrucao | null {
  const [opcao, valor, ...resto] = argumentos;
  if (resto.length > 0) return null;
  if (opcao === "--todas" && valor === undefined) return "todas";
  if (opcao === "--empresa" && valor !== undefined && UUID.test(valor)) return { empresaId: valor };
  return null;
}

export const USO_DA_RECONSTRUCAO =
  "Uso: reconstruir-projecoes --empresa <uuid da empresa> | reconstruir-projecoes --todas";

export interface ResumoDaReconstrucao {
  empresaId: string;
  ctes: number;
  alterados: number;
}

/** Uma empresa por vez, uma transação por lote de CT-e, no contexto (RLS) de cada empresa. */
export async function reconstruirProjecoes(
  executar: ExecutorDoWorker,
  log: Logger,
  alvo: AlvoDaReconstrucao,
): Promise<ResumoDaReconstrucao[]> {
  const empresas =
    alvo === "todas"
      ? (
          await executar(
            { empresaId: null, usuarioId: null, plataforma: true },
            ({ agendamentos }) => agendamentos.empresasAtivas(),
          )
        ).map(({ id }) => id)
      : [alvo.empresaId];
  const resumos: ResumoDaReconstrucao[] = [];
  for (const empresaId of empresas) {
    const contexto = { empresaId, usuarioId: null, plataforma: false };
    const r = await reconstruirProjecoesDoRomaneio(
      (fn) => executar(contexto, ({ projecoesRomaneio }) => fn(projecoesRomaneio)),
      TAMANHO_DO_LOTE,
    );
    log.info({ empresaId, ...r }, "projeções do romaneio reconstruídas");
    resumos.push({ empresaId, ...r });
  }
  return resumos;
}
