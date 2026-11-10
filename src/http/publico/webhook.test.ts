/** Movido de erp-ssw/apps/api/src/modulos/ingestao-ssw/rotas.test.ts (parte do webhook). */
import { randomBytes } from "node:crypto";

import { cifrarSegredo, contextoDoSegredo, lerChavesDeSegredo } from "@erp/db/segredos";
import { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resumoDoSegredo } from "../../fontes/webhook/recepcao";
import {
  appDeTeste,
  criarContadorEmMemoria,
  FilaDoWebhookFalsa,
  RecepcaoFalsa,
} from "../../testes/http";
import { LIMITE_DE_FALHAS_POR_MINUTO } from "./webhook";

const chaves = lerChavesDeSegredo(`1:${randomBytes(32).toString("base64")}`, 1);
const SEGREDO_WEBHOOK = "s".repeat(40);
const EMPRESA = "00000000-0000-4000-8000-0000000000aa";
const URL = "/api/public/ssw-ocorrencias";
const EVENTO = {
  cte: { numeroCTe: "123456" },
  ocorrencia: { codigo: "1", dataHoraEvento: "09-11-2026 10:30:00" },
  nf: { numeroNFe: "987" },
};

let app: FastifyInstance;
let banco: RecepcaoFalsa;
let filas: FilaDoWebhookFalsa;

beforeEach(async () => {
  banco = new RecepcaoFalsa();
  filas = new FilaDoWebhookFalsa();
  app = await appDeTeste({
    webhook: {
      executar: banco.executar,
      filas,
      chaves,
      falhas: criarContadorEmMemoria(60_000),
    },
  });
});
afterEach(() => app.close());

function cadastrarWebhook(ativa = true) {
  banco.empresas.push({
    id: EMPRESA,
    slug: "fr",
    nome: "FR Transportes",
    status: "ativa",
    integracaoAtiva: ativa,
    parametros: {},
    segredo: cifrarSegredo(chaves, SEGREDO_WEBHOOK, contextoDoSegredo(EMPRESA, "ssw_webhook")),
  });
}

describe("Webhook SSW2181 (/api/public/ssw-ocorrencias)", () => {
  it("GET informa como enviar", async () => {
    const r = await app.inject({ url: URL });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.json()).toMatchObject({ ok: true, metodo: "POST" });
  });

  it("401 sem autorização, sem gravar evento quando a empresa não é conhecida", async () => {
    cadastrarWebhook();
    const r = await app.inject({ method: "POST", url: URL, payload: EVENTO });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject([{ retorno: { codigo: 401, motivo: "autorizacao_ausente" } }]);
    expect(banco.eventos).toEqual([]);
  });

  it("segredo na query: grava o evento autenticado e enfileira o processamento", async () => {
    cadastrarWebhook();
    const r = await app.inject({
      method: "POST",
      url: `${URL}?secret=${SEGREDO_WEBHOOK}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(EVENTO),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject([{ retorno: { codigo: 200 } }]);
    const [evento] = banco.eventos;
    expect(evento).toMatchObject({ empresaId: EMPRESA, autenticado: true, statusHttp: 200 });
    expect(filas.enfileirados).toEqual([
      {
        job: "processar-webhook-ssw",
        dados: expect.objectContaining({ empresaId: EMPRESA, eventoId: evento?.id }) as unknown,
        deduplicar: `ssw_webhook__${evento?.id ?? ""}`,
      },
    ]);
    // A busca da dona é da Plataforma; a gravação, no contexto (RLS) da empresa do evento.
    expect(banco.contextos).toContainEqual({ empresaId: null, usuarioId: null, plataforma: true });
    expect(banco.contextos).toContainEqual({
      empresaId: EMPRESA,
      usuarioId: null,
      plataforma: false,
    });
  });

  it("sem token válido, recusa antes de ler o corpo e não guarda o conteúdo", async () => {
    cadastrarWebhook();
    const r = await app.inject({
      method: "POST",
      url: `${URL}?empresa=fr`,
      headers: { "content-type": "application/json" },
      payload: "{nao é json",
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject([{ retorno: { motivo: "autorizacao_ausente" } }]);
    expect(banco.eventos).toMatchObject([
      { motivoRejeicao: "autorizacao_ausente", payloadBruto: null },
    ]);
  });

  it("IP do evento é o request.ip: cabeçalho cf-connecting-ip forjado é ignorado", async () => {
    cadastrarWebhook();
    await app.inject({
      method: "POST",
      url: `${URL}?empresa=fr&secret=errado`,
      headers: { "cf-connecting-ip": "203.0.113.9" },
      payload: EVENTO,
    });
    expect(banco.eventos[0]?.ip).toBe("127.0.0.1");
  });

  it("limite próprio e baixo para falhas: depois dele, 429 sem gravar nada", async () => {
    cadastrarWebhook();
    const tentar = () =>
      app.inject({ method: "POST", url: `${URL}?empresa=fr&secret=errado`, payload: EVENTO });
    for (let i = 0; i < LIMITE_DE_FALHAS_POR_MINUTO; i++)
      expect((await tentar()).statusCode).toBe(401);
    expect((await tentar()).statusCode).toBe(429);
    expect(banco.eventos).toHaveLength(LIMITE_DE_FALHAS_POR_MINUTO);
    const valido = await app.inject({
      method: "POST",
      url: `${URL}?secret=${SEGREDO_WEBHOOK}`,
      payload: EVENTO,
    });
    expect(valido.statusCode).toBe(200);
  });

  it("fila fora: 503 para o SSW reenviar, com o evento marcado", async () => {
    cadastrarWebhook();
    filas.falhar = true;
    const r = await app.inject({
      method: "POST",
      url: URL,
      headers: { authorization: `Bearer ${SEGREDO_WEBHOOK}` },
      payload: EVENTO,
    });
    expect(r.statusCode).toBe(503);
    expect(banco.eventos[0]).toMatchObject({ statusHttp: 503 });
  });

  it("JSON inválido é recusado no formato do SSW", async () => {
    cadastrarWebhook();
    const r = await app.inject({
      method: "POST",
      url: URL,
      headers: { "content-type": "application/json", authorization: `Bearer ${SEGREDO_WEBHOOK}` },
      payload: "{nao é json",
    });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject([{ retorno: { codigo: 400 } }]);
  });

  it("recebimento guarda o SHA-256 do token, nunca o token", async () => {
    cadastrarWebhook();
    await app.inject({
      method: "POST",
      url: URL,
      headers: { authorization: `Bearer ${SEGREDO_WEBHOOK}` },
      payload: { cte: { numeroCTe: "1" }, ocorrencia: { codigo: "1" } },
    });
    const [evento] = banco.eventos;
    expect(JSON.stringify(evento)).not.toContain(SEGREDO_WEBHOOK);
    expect(evento?.tokenSha256).toContain(resumoDoSegredo(SEGREDO_WEBHOOK));
  });
});
