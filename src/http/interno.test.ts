import { ErroDeNegocio } from "@erp/domain/errors";
import { JOBS_DE_INGESTAO } from "@erp/shared/ingestion";
import { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { type OperacoesManuais } from "../aplicacao/casos-de-uso";
import {
  erroInterno,
  EXEMPLOS,
  type JobPedivel,
  JOBS_ACOMPANHADOS,
  JOBS_PEDIVEIS,
  LIMITE_DO_ARQUIVO_EM_BASE64,
} from "../contrato-interno";
import { type Execucoes } from "../infra/execucoes";
import { criarJobs, type ServicosDosJobs } from "../jobs/todos";
import { appDeTeste } from "../testes/http";
import { idDeDeduplicacao, tokenAceito } from "./interno";

const TOKEN = "t".repeat(40);
const ANTERIOR = "a".repeat(40);
const EMPRESA = "0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d";
// Os jobs só são lidos aqui (nome, fila e zod dos dados): nenhum serviço é chamado.
const jobs = criarJobs({} as unknown as ServicosDosJobs);

class ExecucoesFalsas implements Execucoes {
  pedidos: { empresaId: string; job: JobPedivel; dados: unknown; deduplicar: string | null }[] = [];
  naFila = new Set<string>();
  pedir(
    empresaId: string,
    job: JobPedivel,
    dados: Record<string, unknown>,
    deduplicar: string | null,
  ) {
    this.pedidos.push({ empresaId, job, dados, deduplicar });
    if (deduplicar !== null && this.naFila.has(deduplicar)) {
      return Promise.resolve({ criada: false as const });
    }
    if (deduplicar !== null) this.naFila.add(deduplicar);
    return Promise.resolve({ criada: true as const, execucaoId: EXEMPLOS.criada.execucaoId });
  }
  consultar(_job: JobPedivel, execucaoId: string) {
    return Promise.resolve(execucaoId === "sumiu" ? null : EXEMPLOS.concluida);
  }
  situacao() {
    return Promise.resolve(EXEMPLOS.situacao);
  }
}

/** Guarda o que a rota repassou e devolve os exemplos do contrato. */
class ManuaisFalsas implements OperacoesManuais {
  chamadas: unknown[][] = [];
  automaticaRodando = false;
  private anotar<T>(nome: string, args: unknown[], r: T) {
    this.chamadas.push([nome, ...args]);
    return Promise.resolve(r);
  }
  retomarCiclo(...a: [string, string]) {
    return this.anotar("retomar", a, EXEMPLOS.cicloRetomado);
  }
  descartarCiclo(...a: [string, string, string | undefined]) {
    return this.anotar("descartar", a, EXEMPLOS.cicloDescartado);
  }
  importarRelatorio(empresaId: string, p: { conteudoBase64: string; aceitarDivergencia: boolean }) {
    return this.anotar(
      "relatorio",
      [empresaId, p.conteudoBase64.length, p.aceitarDivergencia],
      EXEMPLOS.relatorioImportado,
    );
  }
  aplicar(...a: [string, unknown]) {
    if (this.automaticaRodando) {
      return Promise.reject(
        new ErroDeNegocio("CONFLITO", "A aplicação automática está rodando agora."),
      );
    }
    return this.anotar("aplicar", a, EXEMPLOS.resultadoDaAplicacao);
  }
  lerFtp(...a: [string]) {
    return this.anotar("ftp", a, EXEMPLOS.ftp);
  }
  ativarFtp(...a: [string, boolean]) {
    return this.anotar("ativar", a, undefined);
  }
  liberarTravaDoFtp(...a: [string]) {
    return this.anotar("liberar", a, undefined);
  }
  importarXml(empresaId: string, p: { nomeArquivo: string }) {
    return this.anotar("xml", [empresaId, p.nomeArquivo], EXEMPLOS.resultadoDoXml);
  }
}

let app: FastifyInstance | undefined;
afterEach(() => app?.close());

async function montar(tokens: string[] = [TOKEN, ANTERIOR]) {
  const execucoes = new ExecucoesFalsas();
  const manuais = new ManuaisFalsas();
  const novo = await appDeTeste({ interno: { tokens, execucoes, jobs, manuais } });
  app = novo;
  return { execucoes, manuais, app: novo };
}

const pedir = (
  app: FastifyInstance,
  corpo: unknown,
  token = TOKEN,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: "POST",
    url: `/interno/v1/empresas/${EMPRESA}/execucoes`,
    headers: { authorization: `Bearer ${token}`, ...extra },
    payload: corpo as Record<string, unknown>,
  });

describe("HTTP interno: autenticação", () => {
  it("compara o token com os dois aceitos (girar sem queda)", () => {
    expect(tokenAceito(`Bearer ${TOKEN}`, [TOKEN, ANTERIOR])).toBe(true);
    expect(tokenAceito(`Bearer ${ANTERIOR}`, [TOKEN, ANTERIOR])).toBe(true);
    expect(tokenAceito(`Bearer ${TOKEN}x`, [TOKEN, ANTERIOR])).toBe(false);
    expect(tokenAceito(TOKEN, [TOKEN])).toBe(false);
    expect(tokenAceito(undefined, [TOKEN])).toBe(false);
    expect(tokenAceito("Bearer ", [TOKEN])).toBe(false);
  });

  it("sem token: 401; token antigo ainda vale; sem tokens configurados: 503", async () => {
    const { app } = await montar();
    const sem = await app.inject({ url: `/interno/v1/empresas/${EMPRESA}/situacao` });
    expect(sem.statusCode).toBe(401);
    expect(sem.json()).toEqual({
      erro: { codigo: "NAO_AUTENTICADO", mensagem: "Token de serviço ausente ou inválido." },
    });
    expect((await pedir(app, EXEMPLOS.pedido, ANTERIOR)).statusCode).toBe(202);
    await app.close();
    const desligadoApp = (await montar([])).app;
    const desligado = await pedir(desligadoApp, EXEMPLOS.pedido);
    expect(desligado.statusCode).toBe(503);
    expect(desligado.json()).toMatchObject({ erro: { codigo: "INDISPONIVEL" } });
  });

  it("recusa antes de ler o corpo", async () => {
    const { execucoes, app } = await montar();
    const r = await app.inject({
      method: "POST",
      url: `/interno/v1/empresas/${EMPRESA}/execucoes`,
      headers: { authorization: "Bearer errado", "content-type": "application/json" },
      payload: "{nao é json",
    });
    expect(r.statusCode).toBe(401);
    expect(execucoes.pedidos).toEqual([]);
  });

  it("vindo pela borda (X-Forwarded-For) não existe, nem com o token certo", async () => {
    const { app } = await montar();
    const r = await pedir(app, EXEMPLOS.pedido, TOKEN, { "x-forwarded-for": "203.0.113.9" });
    expect(r.statusCode).toBe(404);
  });

  it("token errado também conta no limite de taxa", async () => {
    const { app } = await montar();
    let ultima = 0;
    for (let i = 0; i <= 1200; i++) {
      ultima = (await app.inject({ url: `/interno/v1/empresas/${EMPRESA}/situacao` })).statusCode;
    }
    expect(ultima).toBe(429);
  });
});

describe("HTTP interno: execuções", () => {
  it("pede o job com os dados validados e a empresa do caminho: 202", async () => {
    const { execucoes, app } = await montar();
    const r = await pedir(app, EXEMPLOS.pedido);
    expect(r.statusCode).toBe(202);
    expect(r.json()).toEqual(EXEMPLOS.criada);
    expect(execucoes.pedidos).toEqual([
      {
        empresaId: EMPRESA,
        job: "bi2-0017",
        dados: { modo: "manual", data: "2026-11-09" },
        deduplicar: `bi2-0017__${EMPRESA}`,
      },
    ]);
  });

  it("deduplicar com um já na fila: 409 com mensagem para o operador", async () => {
    const { app } = await montar();
    expect((await pedir(app, EXEMPLOS.pedido)).statusCode).toBe(202);
    const r = await pedir(app, EXEMPLOS.pedido);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual(EXEMPLOS.erro);
  });

  it("job fora da lista, campo desconhecido ou dado inválido: 422 em português", async () => {
    const { execucoes, app } = await montar();
    const fora = await pedir(app, { job: "despachar_ingestao" });
    expect(fora.statusCode).toBe(422);
    const desconhecido = await pedir(app, { job: "sincronizar-ftp", dados: { senha: "x" } });
    expect(desconhecido.statusCode).toBe(422);
    const invalido = await pedir(app, { job: "reprocessar-xml-orfaos", dados: { limite: 5000 } });
    const corpo = erroInterno.parse(invalido.json());
    expect(corpo.erro.codigo).toBe("ENTRADA_INVALIDA");
    expect(corpo.erro.mensagem).toContain("dados.limite");
    const semEmpresa = await app.inject({
      method: "POST",
      url: "/interno/v1/empresas/nao-e-uuid/execucoes",
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: EXEMPLOS.pedido,
    });
    expect(semEmpresa.statusCode).toBe(422);
    expect(execucoes.pedidos).toEqual([]);
  });

  it("consulta a execução; inexistente: 404", async () => {
    const { app } = await montar();
    const headers = { authorization: `Bearer ${TOKEN}` };
    const r = await app.inject({
      url: `/interno/v1/execucoes/bi2-0017/${EXEMPLOS.criada.execucaoId}?aguardarMs=1000`,
      headers,
    });
    expect(r.json()).toEqual(EXEMPLOS.concluida);
    const sumiu = await app.inject({ url: "/interno/v1/execucoes/bi2-0017/sumiu", headers });
    expect(sumiu.statusCode).toBe(404);
    const espera = await app.inject({
      url: "/interno/v1/execucoes/bi2-0017/x?aguardarMs=60001",
      headers,
    });
    expect(espera.statusCode).toBe(422);
  });

  it("situação da empresa no formato do contrato", async () => {
    const { app } = await montar();
    const r = await app.inject({
      url: `/interno/v1/empresas/${EMPRESA}/situacao`,
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.json()).toEqual(EXEMPLOS.situacao);
  });

  it("deduplicação: a mesma do despachante; webhook por evento", () => {
    expect(idDeDeduplicacao("sincronizar-ftp", EMPRESA, {})).toBe(`sincronizar-ftp__${EMPRESA}`);
    expect(idDeDeduplicacao("processar-webhook-ssw", EMPRESA, { eventoId: "e1" })).toBe(
      "ssw_webhook__e1",
    );
    expect(idDeDeduplicacao("projecoes-romaneio-completa", EMPRESA, {})).toBe(
      `projecoes-romaneio-completa__${EMPRESA}`,
    );
  });
});

describe("HTTP interno: operações manuais da Importação SSW", () => {
  const BASE = `/interno/v1/empresas/${EMPRESA}`;
  const headers = { authorization: `Bearer ${TOKEN}` };
  const post = (url: string, payload?: Record<string, unknown>) =>
    app?.inject({ method: "POST", url: `${BASE}${url}`, headers, ...(payload ? { payload } : {}) });

  it("ciclo: retomar e descartar (com e sem motivo), no formato da tela", async () => {
    const { manuais } = await montar();
    expect((await post("/ciclos/c1/retomar"))?.json()).toEqual(EXEMPLOS.cicloRetomado);
    expect((await post("/ciclos/c1/descartar", EXEMPLOS.descarte))?.json()).toEqual(
      EXEMPLOS.cicloDescartado,
    );
    expect((await post("/ciclos/c2/descartar"))?.statusCode).toBe(200);
    const curto = await post("/ciclos/c3/descartar", { motivo: "x" });
    expect(erroInterno.parse(curto?.json()).erro.mensagem).toContain("motivo do descarte");
    expect(manuais.chamadas).toEqual([
      ["retomar", EMPRESA, "c1"],
      ["descartar", EMPRESA, "c1", EXEMPLOS.descarte.motivo],
      ["descartar", EMPRESA, "c2", undefined],
    ]);
  });

  it("relatório e XML aceitam corpo acima de 1 MiB; acima de 64 MB, 422", async () => {
    const { manuais } = await montar();
    const grande = "A".repeat(2 * 1024 * 1024);
    const r = await post("/relatorios", { ...EXEMPLOS.relatorio, conteudoBase64: grande });
    expect(r?.json()).toEqual(EXEMPLOS.relatorioImportado);
    const x = await post("/xml", { ...EXEMPLOS.xml, conteudoBase64: grande });
    expect(x?.json()).toEqual(EXEMPLOS.resultadoDoXml);
    const demais = await post("/xml", {
      ...EXEMPLOS.xml,
      conteudoBase64: "A".repeat(LIMITE_DO_ARQUIVO_EM_BASE64 + 1),
    });
    expect(demais?.statusCode).toBe(422);
    expect(manuais.chamadas).toEqual([
      ["relatorio", EMPRESA, grande.length, false],
      ["xml", EMPRESA, EXEMPLOS.xml.nomeArquivo],
    ]);
  });

  it("o corpo grande vale só para relatório e XML", async () => {
    await montar();
    const r = await post("/aplicacoes", {
      ...EXEMPLOS.aplicacao,
      sobra: "A".repeat(2 * 1024 * 1024),
    });
    expect(r?.statusCode).toBe(422);
    expect(erroInterno.parse(r?.json()).erro.mensagem).toBe("Conteúdo grande demais.");
  });

  it("aplicar: resultado da tela; com a automática rodando, 409 em português", async () => {
    const { manuais } = await montar();
    expect((await post("/aplicacoes", { simular: true }))?.json()).toEqual(
      EXEMPLOS.resultadoDaAplicacao,
    );
    expect(manuais.chamadas).toEqual([
      ["aplicar", EMPRESA, { simular: true, limite: 4000, offset: 0 }],
    ]);
    manuais.automaticaRodando = true;
    const conflito = await post("/aplicacoes", { simular: false });
    expect(conflito?.statusCode).toBe(409);
    expect(erroInterno.parse(conflito?.json()).erro.codigo).toBe("CONFLITO");
  });

  it("FTP: situação, pausa e liberar trava", async () => {
    const { manuais, app } = await montar();
    expect((await app.inject({ url: `${BASE}/ftp`, headers })).json()).toEqual(EXEMPLOS.ftp);
    const pausa = await app.inject({
      method: "PUT",
      url: `${BASE}/ftp/ativo`,
      headers,
      payload: EXEMPLOS.ftpAtivo,
    });
    expect(pausa.json()).toEqual(EXEMPLOS.ok);
    expect((await post("/ftp/liberar-trava"))?.json()).toEqual(EXEMPLOS.ok);
    expect(manuais.chamadas).toEqual([
      ["ftp", EMPRESA],
      ["ativar", EMPRESA, false],
      ["liberar", EMPRESA],
    ]);
  });

  it("sem token não chega à operação", async () => {
    const { manuais, app } = await montar();
    const r = await app.inject({ method: "POST", url: `${BASE}/ftp/liberar-trava` });
    expect(r.statusCode).toBe(401);
    expect(manuais.chamadas).toEqual([]);
  });
});

describe("contrato interno x jobs registrados", () => {
  it("todo job pedível está registrado e aceita os dados mínimos do contrato com a empresa", () => {
    const minimos: Record<JobPedivel, Record<string, unknown>> = {
      "sincronizar-ftp": {},
      "sincronizar-ftp-retroativo": {},
      "aplicar-ciclos": {},
      "bi2-0017": {},
      "verificar-token-ssw": { manual: true },
      "processar-webhook-ssw": { eventoId: EMPRESA, protocolo: "123" },
      "reprocessar-xml-orfaos": { limite: 10 },
      "projecoes-romaneio": { chaves: [{ sigla: "CAP", numero: "1" }] },
      "projecoes-romaneio-completa": {},
    };
    for (const job of JOBS_PEDIVEIS) {
      const definicao = jobs.find((j) => j.nome === job);
      expect(definicao, job).toBeDefined();
      expect(definicao?.dados.safeParse({ ...minimos[job], empresaId: EMPRESA }).success, job).toBe(
        true,
      );
    }
  });

  it("a situação cobre todos os jobs do Diagnóstico SSW, e cada um tem fila registrada", () => {
    for (const { job } of JOBS_DE_INGESTAO) expect(JOBS_ACOMPANHADOS, job).toContain(job);
    for (const job of JOBS_ACOMPANHADOS)
      expect(
        jobs.some((j) => j.nome === job),
        job,
      ).toBe(true);
  });
});
