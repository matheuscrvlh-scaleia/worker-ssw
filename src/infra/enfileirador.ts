/**
 * Filas do BullMQ do worker-ssw (uma `Queue` por fila, reaproveitada por quem produz: rotas
 * públicas, HTTP interno, despachante e os casos de uso que pedem jobs de outros domínios).
 */
import { OPCOES_PADRAO_DO_JOB, PREFIXO_DAS_FILAS } from "@erp/shared/ingestion";
import { Queue } from "bullmq";
import { type Redis } from "ioredis";

import { type Enfileirador } from "../aplicacao/casos-de-uso/portas";

export interface Filas extends Enfileirador {
  fila(nome: string): Queue;
  fechar(): Promise<void>;
}

export function criarFilas(redis: Redis): Filas {
  const filas = new Map<string, Queue>();
  const fila = (nome: string) => {
    let q = filas.get(nome);
    if (!q) {
      q = new Queue(nome, {
        connection: redis,
        prefix: PREFIXO_DAS_FILAS,
        defaultJobOptions: OPCOES_PADRAO_DO_JOB,
      });
      filas.set(nome, q);
    }
    return q;
  };
  return {
    fila,
    async enfileirar(nomeDaFila, nome, dados, opcoes) {
      await fila(nomeDaFila).add(
        nome,
        dados,
        opcoes?.deduplicacao ? { deduplication: { id: opcoes.deduplicacao } } : {},
      );
    },
    async fechar() {
      await Promise.all([...filas.values()].map((q) => q.close()));
    },
  };
}
