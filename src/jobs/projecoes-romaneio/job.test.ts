import { randomUUID } from "node:crypto";

import { chaveDoCte } from "@erp/dominio/romaneio/projecoes";
import { linha036 } from "@erp/dominio/testes/romaneio";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { BancoFalso } from "../../testes/banco-falso";
import { agendamentosDesejados } from "../agendamentos/agendamentos";
import { criarProcessador } from "../processador";
import { recalcularProjecoesRomaneio, reconstruirProjecoesRomaneio } from "./job";

const EMPRESA = randomUUID();
const CHAVE = { sigla: "CAP", numero: "38984" };

function montar() {
  const banco = new BancoFalso();
  const projecoes = banco.projecoes;
  projecoes.linhas.set(chaveDoCte(CHAVE), { l036: [linha036()], l306: [], l038: [], l455: [] });
  projecoes.chaves = [CHAVE, { sigla: "CAP", numero: "1" }];
  const contextos = banco.contextos;
  const executar = banco.executar;
  const avisos: string[] = [];
  const log = pino({ level: "info" }, { write: (linha: string) => avisos.push(linha) });
  const processar = criarProcessador({
    jobs: [recalcularProjecoesRomaneio, reconstruirProjecoesRomaneio],
    executar,
    log,
    agora: () => new Date("2026-11-10T05:30:00Z"),
  });
  return { projecoes, contextos, avisos, processar };
}

describe("projeções do romaneio", () => {
  it("incremental: recalcula as chaves recebidas no contexto da empresa", async () => {
    const m = montar();
    await m.processar({
      name: "projecoes-romaneio",
      data: { empresaId: EMPRESA, chaves: [CHAVE] },
    });
    expect(m.contextos).toEqual([{ empresaId: EMPRESA, usuarioId: null, plataforma: false }]);
    expect(m.projecoes.gravadasAgora).toMatchObject([{ chave: CHAVE, saidas: ["2026-11-10"] }]);
  });

  it("completa: o que o incremental já fez não é divergência; o que faltou vira aviso", async () => {
    const m = montar();
    await m.processar({ name: "projecoes-romaneio-completa", data: { empresaId: EMPRESA } });
    expect(m.avisos.at(-1)).toContain('"alterados":1');
    expect(m.avisos.at(-1)).toContain('"level":40');

    await m.processar({ name: "projecoes-romaneio-completa", data: { empresaId: EMPRESA } });
    expect(m.avisos.at(-1)).toContain('"alterados":0');
    expect(m.avisos.at(-1)).toContain('"level":30');
  });

  it("só a reconstrução completa é agendada (de madrugada, por empresa)", () => {
    const desejados = agendamentosDesejados(
      [recalcularProjecoesRomaneio, reconstruirProjecoesRomaneio],
      [{ id: EMPRESA, fuso: "America/Sao_Paulo" }],
    );
    expect(desejados.map((d) => d.job)).toEqual(["projecoes-romaneio-completa"]);
  });
});
