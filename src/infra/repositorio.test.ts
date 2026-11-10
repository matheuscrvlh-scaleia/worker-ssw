import { type Transacao } from "@erp/db";
import { describe, expect, it } from "vitest";

import { criarRepositorioIngestao } from "./repositorio";

/** Transação falsa: só guarda o que seria inserido (nada vai ao banco). */
function transacaoQueGuarda() {
  const inseridos: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inseridos.push(v);
        return Promise.resolve();
      },
    }),
  } as unknown as Transacao;
  return { tx, inseridos };
}

const EVENTO = {
  acao: "ingestao.aplicar",
  entidade: "ingestao",
  entidadeId: null,
  resumo: "Aplicou o bloco",
  depois: { inseridos: 1 },
};

describe("auditar da ingestão", () => {
  it("grava IP e navegador do usuário, como a auditoria da API", async () => {
    const { tx, inseridos } = transacaoQueGuarda();
    const ator = {
      usuarioId: "u1",
      email: "op@fr.com",
      plataforma: false,
      ip: "10.0.0.1",
      userAgent: "Firefox",
    };
    await criarRepositorioIngestao(tx, "e1", ator).auditar(EVENTO);
    expect(inseridos).toEqual([
      expect.objectContaining({
        empresaId: "e1",
        atorId: "u1",
        atorEmail: "op@fr.com",
        atorTipo: "usuario",
        acao: "ingestao.aplicar",
        ip: "10.0.0.1",
        userAgent: "Firefox",
      }),
    ]);
  });

  it("sistema (job, rota pública) grava sem IP nem navegador", async () => {
    const { tx, inseridos } = transacaoQueGuarda();
    await criarRepositorioIngestao(tx, "e1", null).auditar(EVENTO);
    expect(inseridos).toEqual([
      expect.objectContaining({ atorTipo: "sistema", atorId: null, ip: null, userAgent: null }),
    ]);
  });
});
