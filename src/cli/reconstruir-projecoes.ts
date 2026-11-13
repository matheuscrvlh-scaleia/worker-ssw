/**
 * `reconstruir-projecoes`: refaz as projeções do Romaneio (viagens, saídas, romaneio atual, dados
 * 038/455 e conferente). Usado na virada (antes era o migrador do ERP) e quando se desconfia de
 * divergência. Roda na hora, sem fila:
 *
 *   node dist/main.js reconstruir-projecoes --empresa <uuid>
 *   node dist/main.js reconstruir-projecoes --todas
 *   node dist/main.js reconstruir-projecoes --todas --origem-url <conexão> [--confirmar-producao]
 *
 * Sem `--origem-url`, lê as linhas guardadas em `erp.ingestao_linhas` (últimos 60 dias). Na virada,
 * `--origem-url` lê a staging inteira do `public` do sistema atual (só leitura), para não perder as
 * viagens antigas. Grava sempre no `erp`.
 */
import { reconstruirProjecoesDoRomaneio } from "@erp/domain/manifest/projections";
import { type Logger } from "pino";

import { TAMANHO_DO_LOTE } from "../jobs/projecoes-romaneio/job";
import { type ExecutorDoWorker } from "../jobs/registro";
import {
  chavesDaOrigem,
  comLinhasDaOrigem,
  ehProducao,
  type OrigemDaStaging,
} from "./origem-public";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlvoDaReconstrucao = { empresaId: string } | "todas";

export interface PedidoDeReconstrucao {
  alvo: AlvoDaReconstrucao;
  /** Conexão do sistema atual (papel postgres); `null` = ler do `erp`. */
  origemUrl: string | null;
}

export const USO_DA_RECONSTRUCAO =
  "Uso: reconstruir-projecoes (--empresa <uuid da empresa> | --todas) " +
  "[--origem-url <conexão do sistema atual> [--confirmar-producao]]";

const RECUSA_DE_PRODUCAO =
  "A --origem-url aponta para o banco de produção. Confira a conexão; se é isso mesmo, repita " +
  "com --confirmar-producao.";

/** Argumentos depois do nome do comando: o pedido, ou a mensagem para o operador. */
export function lerPedido(argumentos: readonly string[]): PedidoDeReconstrucao | { erro: string } {
  let alvo: AlvoDaReconstrucao | null = null;
  let origemUrl: string | null = null;
  let confirmarProducao = false;
  const uso = { erro: USO_DA_RECONSTRUCAO };
  for (let i = 0; i < argumentos.length; i++) {
    const opcao = argumentos[i];
    const valor = argumentos[i + 1];
    if (opcao === "--todas" && alvo === null) alvo = "todas";
    else if (opcao === "--empresa" && alvo === null && valor !== undefined && UUID.test(valor)) {
      alvo = { empresaId: valor };
      i++;
    } else if (opcao === "--origem-url" && origemUrl === null && valor && !valor.startsWith("--")) {
      origemUrl = valor;
      i++;
    } else if (opcao === "--confirmar-producao" && !confirmarProducao) confirmarProducao = true;
    else return uso;
  }
  if (alvo === null) return uso;
  if (confirmarProducao && origemUrl === null) return uso;
  if (origemUrl !== null && ehProducao(origemUrl) && !confirmarProducao) {
    return { erro: RECUSA_DE_PRODUCAO };
  }
  return { alvo, origemUrl };
}

export interface ResumoDaReconstrucao {
  empresaId: string;
  ctes: number;
  alterados: number;
}

/**
 * Uma empresa por vez, uma transação por lote de CT-e, no contexto (RLS) de cada empresa. Com
 * `origem`, as chaves e as linhas vêm da staging do `public`; a gravação é sempre no `erp`.
 */
export async function reconstruirProjecoes(
  executar: ExecutorDoWorker,
  log: Logger,
  alvo: AlvoDaReconstrucao,
  origem: OrigemDaStaging | null = null,
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
    const chaves = origem ? await chavesDaOrigem(origem, empresaId) : null;
    const r = await reconstruirProjecoesDoRomaneio(
      (fn) =>
        executar(contexto, ({ projecoesRomaneio }) =>
          fn(
            origem && chaves
              ? comLinhasDaOrigem(projecoesRomaneio, origem, empresaId, chaves)
              : projecoesRomaneio,
          ),
        ),
      TAMANHO_DO_LOTE,
    );
    log.info(
      { empresaId, origem: origem ? "public (staging inteira)" : "erp.ingestao_linhas", ...r },
      "projeções do romaneio reconstruídas",
    );
    resumos.push({ empresaId, ...r });
  }
  return resumos;
}
