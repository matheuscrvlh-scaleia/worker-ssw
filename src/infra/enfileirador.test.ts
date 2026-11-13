import { OPCOES_PADRAO_DO_JOB, PREFIXO_DAS_FILAS } from "@erp/shared/ingestion";
import { type Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

const criadas = vi.hoisted(() => [] as { nome: string; opcoes: unknown }[]);

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(nome: string, opcoes: unknown) {
      criadas.push({ nome, opcoes });
    }
    add() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  },
}));

const { criarFilas } = await import("./enfileirador");

describe("criarFilas", () => {
  it("usa o prefixo e a política de jobs do catálogo e reaproveita a fila", async () => {
    const redis = {} as Redis;
    const filas = criarFilas(redis);
    await filas.enfileirar("ingestao", "ftp", { empresaId: "e1" });
    expect(filas.fila("ingestao")).toBe(filas.fila("ingestao"));
    expect(criadas).toEqual([
      {
        nome: "ingestao",
        opcoes: {
          connection: redis,
          prefix: PREFIXO_DAS_FILAS,
          defaultJobOptions: OPCOES_PADRAO_DO_JOB,
        },
      },
    ]);
  });
});
