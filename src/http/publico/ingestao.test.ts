/** Movido de erp-ssw/apps/api/src/modulos/ingestao/rotas.test.ts (parte das rotas públicas). */
import { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CABECALHO_930 } from "../../fontes/relatorios";
import { enfileiradorFalso, estadoFalso, executarFalso } from "../../testes/falsos";
import { appDeTeste } from "../../testes/http";
import { segredoConfere } from "./ingestao";
import { type SegredoDaIngestao, type ServicosDaIngestao } from "./servicos";

const SEGREDO = "segredo-do-ftp-de-teste";
const LINHA =
  '1;"CAP033214-5";"03/11/26";"1";"55001";"1";"12345";"";"FRT";"CAP";"04/11/26";"10:00";"04/11/26";"10:00";"usuario";"1";"ENTREGA";"";"";"";"";"";"11222333000181";"CLIENTE EXEMPLO LTDA"';
const ARQUIVO = Buffer.from([CABECALHO_930.join(";"), LINHA].join("\r\n"), "latin1").toString(
  "base64",
);

const EMPRESA = "00000000-0000-4000-8000-000000000001";
const OUTRA = "00000000-0000-4000-8000-000000000002";
const SEGREDO_DA_OUTRA = "segredo-da-outra-empresa";

let app: FastifyInstance;
let estado: ReturnType<typeof estadoFalso>;
let enfileirador: ReturnType<typeof enfileiradorFalso>;
let integracoes: string[];
let segredos: SegredoDaIngestao[];
let falharGravacao: boolean;

beforeEach(async () => {
  estado = estadoFalso();
  enfileirador = enfileiradorFalso();
  integracoes = ["sftp"];
  falharGravacao = false;
  segredos = [
    { empresaId: EMPRESA, segredo: SEGREDO },
    { empresaId: OUTRA, segredo: SEGREDO_DA_OUTRA },
  ];
  const ingestao: ServicosDaIngestao = {
    executarNaEmpresa: () =>
      falharGravacao
        ? () => Promise.reject(new Error("Failed query: insert ... params: dado-sensivel"))
        : executarFalso(estado),
    empresasParaIngestao: () =>
      Promise.resolve([
        { id: EMPRESA, slug: "fr", nome: "FR", status: "ativa", integracoesAtivas: integracoes },
        { id: OUTRA, slug: "outra", nome: "Outra", status: "ativa", integracoesAtivas: ["sftp"] },
      ]),
    segredosDaIngestao: () => Promise.resolve(segredos),
    enfileirador,
  };
  app = await appDeTeste({ ingestao });
});
afterEach(() => app.close());

const importar = (headers: Record<string, string>, corpo: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/public/ftp-relatorio-import",
    headers,
    payload: { nome: "930_ocorrencias_2026-11-05_1000.csv", base64: ARQUIVO, ...corpo },
  });

describe("rotas públicas da ingestão", () => {
  it("segredo comparado em tempo constante", () => {
    expect(segredoConfere("abc", "abc")).toBe(true);
    expect(segredoConfere("abcd", "abc")).toBe(false);
    expect(segredoConfere(undefined, "abc")).toBe(false);
    expect(segredoConfere("abc", null)).toBe(false);
  });

  it("ftp-relatorio-import: 401 sem segredo; 400 sem arquivo; 409 integração desligada; grava", async () => {
    expect((await importar({})).statusCode).toBe(401);
    expect((await importar({ "x-ftp-ingest-secret": "errado" })).json()).toMatchObject({
      ok: false,
      motivo: "token_invalido",
    });
    const semArquivo = await importar({ "x-ftp-ingest-secret": SEGREDO }, { base64: "" });
    expect(semArquivo.json()).toMatchObject({ motivo: "nome_ou_base64_ausentes" });
    const r = await importar({ "x-ftp-ingest-secret": SEGREDO });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({
      ok: true,
      status: "importado",
      relatorio: "930",
      gravados: 1,
    });
    integracoes = [];
    const desligada = await importar({ "x-ftp-ingest-secret": SEGREDO });
    expect(desligada.statusCode).toBe(409);
    expect(desligada.json()).toMatchObject({ motivo: "integracao_desligada" });
  });

  it("sem segredo, recusa antes de ler e validar o corpo (onRequest)", async () => {
    const invalido = await app.inject({
      method: "POST",
      url: "/api/public/ftp-relatorio-import",
      headers: { "content-type": "application/json" },
      payload: "{nao é json",
    });
    expect(invalido.statusCode).toBe(401);
    const foraDoSchema = await importar({}, { nome: 123 });
    expect(foraDoSchema.statusCode).toBe(401);
    const orfaos = await app.inject({
      method: "POST",
      url: "/api/public/xml-orfaos-retry",
      payload: { limite: "muitos" },
    });
    expect(orfaos.statusCode).toBe(401);
  });

  it("corpo acima do limite sem arquivo: 413 antes de processar", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/public/ssw-ciclo-aplicar",
      headers: { "x-cron-token": SEGREDO, "content-type": "application/json" },
      payload: JSON.stringify({ empresa: "x".repeat(2 * 1024 * 1024) }),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ erro: { mensagem: "Conteúdo grande demais." } });
    expect(enfileirador.jobs).toEqual([]);
  });

  it("ssw-ciclo-aplicar aceita o token do cron e só enfileira o job", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/public/ssw-ciclo-aplicar?empresa=fr",
      headers: { "x-cron-token": SEGREDO },
      payload: {},
    });
    expect(r.json()).toMatchObject({ ok: true, status: "enfileirado" });
    expect(enfileirador.jobs).toEqual([{ nome: "aplicar-ciclos", dados: { empresaId: EMPRESA } }]);
  });

  it("o segredo é da empresa: escolhe a empresa e não serve para pedir outra", async () => {
    const daOutra = await importar({ "x-ftp-ingest-secret": SEGREDO_DA_OUTRA }, { empresa: "fr" });
    expect(daOutra.statusCode).toBe(404);
    expect(estado.linhas).toHaveLength(0);
    const r = await app.inject({
      method: "POST",
      url: "/api/public/ssw-ciclo-aplicar",
      headers: { "x-ftp-ingest-secret": SEGREDO_DA_OUTRA },
      payload: {},
    });
    expect(r.json()).toMatchObject({ ok: true });
    expect(enfileirador.jobs).toEqual([{ nome: "aplicar-ciclos", dados: { empresaId: OUTRA } }]);
  });

  it("sem segredo cadastrado em nenhuma empresa: 503 dizendo onde cadastrar", async () => {
    segredos = [];
    const r = await importar({ "x-ftp-ingest-secret": SEGREDO });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ motivo: "ingest_secret_nao_configurado" });
  });

  it("exceção no pipeline responde mensagem genérica (sem o erro interno)", async () => {
    falharGravacao = true;
    const r = await importar({ "x-ftp-ingest-secret": SEGREDO });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toMatchObject({ motivo: "excecao_no_pipeline" });
    expect(r.body).not.toContain("dado-sensivel");
    expect(r.body).not.toContain("Failed query");
  });

  it("limite de taxa por rota: xml-orfaos-retry aceita 30 por minuto", async () => {
    const pedir = () =>
      app.inject({
        method: "POST",
        url: "/api/public/xml-orfaos-retry",
        headers: { "x-ftp-ingest-secret": "errado" },
        payload: {},
      });
    for (let i = 0; i < 30; i++) expect((await pedir()).statusCode).toBe(401);
    expect((await pedir()).statusCode).toBe(429);
  });

  it("rotas 410 do sistema antigo não existem (Q46)", async () => {
    const r = await app.inject({ method: "POST", url: "/api/public/ftp-xml-import", payload: {} });
    expect(r.statusCode).toBe(404);
  });
});
