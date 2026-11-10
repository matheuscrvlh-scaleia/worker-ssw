import { chaveDoCte } from "@erp/dominio/romaneio/projecoes";
import { linha036 } from "@erp/dominio/testes/romaneio";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { BancoFalso } from "../testes/banco-falso";
import { abrirOrigem, type ClienteDaOrigem, type OrigemDaStaging } from "./origem-public";
import { lerPedido, reconstruirProjecoes, USO_DA_RECONSTRUCAO } from "./reconstruir-projecoes";

const A = "0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d";
const B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const log = pino({ level: "silent" });
const DEVELOP = "postgresql://postgres:x@db.vyockehhhvomqcjqnuwb.supabase.co:5432/postgres";
const PRODUCAO = "postgresql://postgres:x@db.quyrhwmfbqikkpmiivuq.supabase.co:5432/postgres";

/** Staging do `public` falsa: responde pela tabela citada no SQL e guarda o que foi pedido. */
function origemFalsa(respostas: Record<string, object[]>): OrigemDaStaging & { sqls: string[] } {
  const sqls: string[] = [];
  return {
    sqls,
    consultar: <T extends object>(sql: string) => {
      sqls.push(sql);
      const chave = Object.keys(respostas).find((k) => sql.includes(k));
      return Promise.resolve((chave ? respostas[chave] : []) as T[]);
    },
  };
}

describe("reconstruir-projecoes: argumentos", () => {
  it("uma empresa pelo id ou todas; o resto é uso errado", () => {
    expect(lerPedido(["--empresa", A])).toEqual({ alvo: { empresaId: A }, origemUrl: null });
    expect(lerPedido(["--todas"])).toEqual({ alvo: "todas", origemUrl: null });
    for (const errado of [
      [],
      ["--empresa", "fr"],
      ["--todas", "--empresa", A],
      ["--todas", "--origem-url"],
      ["--todas", "--confirmar-producao"],
      ["--todas", "--outra"],
    ]) {
      expect(lerPedido(errado), errado.join(" ")).toEqual({ erro: USO_DA_RECONSTRUCAO });
    }
  });

  it("--origem-url lê do sistema atual; produção só com --confirmar-producao", () => {
    expect(lerPedido(["--todas", "--origem-url", DEVELOP])).toEqual({
      alvo: "todas",
      origemUrl: DEVELOP,
    });
    const recusa = lerPedido(["--empresa", A, "--origem-url", PRODUCAO]);
    expect(recusa).toMatchObject({ erro: expect.stringContaining("produção") as unknown });
    expect(JSON.stringify(recusa)).not.toContain("postgres:x");
    expect(lerPedido(["--origem-url", PRODUCAO, "--confirmar-producao", "--empresa", A])).toEqual({
      alvo: { empresaId: A },
      origemUrl: PRODUCAO,
    });
  });
});

describe("reconstruir-projecoes: execução", () => {
  it("todas: lista as empresas pela Plataforma e reconstrói cada uma no contexto dela", async () => {
    const banco = new BancoFalso();
    banco.empresas = [
      { id: A, integracoes: [] },
      { id: B, integracoes: [] },
    ];
    const chave = { sigla: "CAP", numero: "38984" };
    banco.projecoes.chaves = [chave];
    banco.projecoes.linhas.set(chaveDoCte(chave), {
      l036: [linha036()],
      l306: [],
      l038: [],
      l455: [],
    });

    const resumos = await reconstruirProjecoes(banco.executar, log, "todas");

    expect(resumos.map((r) => r.empresaId)).toEqual([A, B]);
    expect(resumos[0]).toMatchObject({ ctes: 1 });
    expect(banco.contextos).toEqual([
      { empresaId: null, usuarioId: null, plataforma: true },
      { empresaId: A, usuarioId: null, plataforma: false },
      { empresaId: B, usuarioId: null, plataforma: false },
    ]);
  });

  it("uma empresa: não consulta a lista de empresas", async () => {
    const banco = new BancoFalso();
    await reconstruirProjecoes(banco.executar, log, { empresaId: A });
    expect(banco.contextos).toEqual([{ empresaId: A, usuarioId: null, plataforma: false }]);
  });

  it("com a origem: chaves e linhas da staging inteira do public, gravação no erp", async () => {
    const banco = new BancoFalso();
    // Nada no erp.ingestao_linhas: sem a origem, a viagem de agosto se perderia.
    const origem = origemFalsa({
      union: [{ numero: "38984", sigla: "CAP" }],
      "public.staging_036_romaneios o": [
        {
          sigla: "CAP",
          numero: "38984",
          importado_em: "2026-08-01T12:00:00+00:00",
          dados: {
            ctrc: "CAP038984-6",
            romaneio: "R1",
            data_emissao: "2026-08-01",
            situacao: "BAIXADO",
            conferente: " ANA ",
          },
        },
      ],
      "public.staging_455_ctrcs_expedidos o": [
        {
          sigla: "CAP",
          numero: "38984",
          importado_em: "2026-08-01T12:00:00+00:00",
          dados: { valor_mercadoria: 1500.5 },
        },
      ],
    });

    const [resumo] = await reconstruirProjecoes(banco.executar, log, { empresaId: A }, origem);

    expect(resumo).toMatchObject({ empresaId: A, ctes: 1, alterados: 1 });
    const [gravada] = banco.projecoes.gravadasAgora;
    expect(gravada?.chave).toEqual({ sigla: "CAP", numero: "38984" });
    expect(gravada?.viagens.map((v) => v.romaneio)).toEqual(["R1"]);
    expect(gravada?.dados?.valorMercadoria).toBe(1500.5);
    expect(origem.sqls.every((s) => /^\s*select/i.test(s))).toBe(true);
  });

  it("abre a origem em só leitura antes de qualquer consulta e fecha no fim", async () => {
    const comandos: string[] = [];
    const cliente: ClienteDaOrigem = {
      connect: () => Promise.resolve(comandos.push("connect")),
      query: (sql: string) => {
        comandos.push(sql);
        return Promise.resolve({ rows: [] });
      },
      end: () => Promise.resolve(void comandos.push("end")),
    };
    const origem = await abrirOrigem(DEVELOP, () => cliente);
    await origem.consultar("select 1", []);
    await origem.encerrar();
    expect(comandos).toEqual([
      "connect",
      "SET default_transaction_read_only = on",
      "select 1",
      "end",
    ]);
  });
});
