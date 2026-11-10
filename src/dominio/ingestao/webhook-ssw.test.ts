import { describe, expect, it } from "vitest";

import {
  candidatosDaCredencial,
  cnpjTransportadoraAceito,
  conferirSegredo,
  cteVigente,
  emissaoDoCteDoWebhook,
  extrairTokensAuthorization,
  gerarProtocolo,
  headerContemSegredo,
  lerDataHoraSsw,
  lerEventoSsw2181,
  normalizarNumeroCtrc,
  podeCriarCteDoWebhook,
  respostaSsw2181,
  siglaCtrc,
  statusHttpDoErro,
} from "./webhook-ssw";

const SEGREDO = "segredo-do-webhook-com-quarenta-e-oito-caracteres!";

function corpo(extra: { cte?: object; nf?: object; ocorrencia?: object } = {}) {
  return {
    cnpjTransportadora: "12.345.678/0001-90",
    nf: { numeroNFe: 5501, serieNFe: "1", pedido: "PED-1", chaveNFe: "", ...extra.nf },
    cte: { numeroCTe: "CAP033214-5", numeroSSW: "0", ...extra.cte },
    ocorrencia: {
      codigo: "85",
      descricao: "SAIDA PARA ENTREGA",
      dataHoraEvento: "05-11-2026 08:30:00",
      complemento: "",
      ...extra.ocorrencia,
    },
  };
}

describe("autorização do webhook", () => {
  it("lê Bearer, Token, Basic (usuário, senha e usuário:senha) e valor cru", () => {
    expect(extrairTokensAuthorization("Bearer abc")).toEqual({
      esquema: "bearer",
      tokens: ["abc"],
    });
    expect(extrairTokensAuthorization('Token "abc"')).toEqual({
      esquema: "token",
      tokens: ["abc"],
    });
    expect(extrairTokensAuthorization(`Basic ${btoa(`ssw:${SEGREDO}`)}`)).toEqual({
      esquema: "basic",
      tokens: ["ssw", SEGREDO, `ssw:${SEGREDO}`],
    });
    expect(extrairTokensAuthorization("abc")).toEqual({ esquema: "raw", tokens: ["abc"] });
    expect(extrairTokensAuthorization("")).toEqual({ esquema: "ausente", tokens: [] });
    expect(extrairTokensAuthorization("Basic %%%")).toEqual({ esquema: "basic", tokens: [] });
  });

  it("aceita Basic base64(usuario:segredo) e o segredo de 48 embutido num header de 74", () => {
    expect(conferirSegredo(SEGREDO, `Basic ${btoa(`ssw:${SEGREDO}`)}`, "")).toEqual({ tipo: "ok" });
    const embrulhado = `pre-${SEGREDO}-sufixo-do-ssw-x`;
    expect(embrulhado.length).toBeGreaterThan(SEGREDO.length);
    expect(headerContemSegredo(embrulhado, SEGREDO)).toBe(true);
    expect(conferirSegredo(SEGREDO, embrulhado, "")).toEqual({ tipo: "ok" });
  });

  it("segredo curto só vale exato; query também vale; recusa diz a origem e o tamanho", () => {
    expect(headerContemSegredo("xxcurtoxx", "curto")).toBe(false);
    expect(conferirSegredo("curto", "", "curto")).toEqual({ tipo: "ok" });
    expect(conferirSegredo("curto", "Bearer errado", "")).toEqual({
      tipo: "recusado",
      motivo: "token_incorreto",
      origem: "header",
      comprimento: 6,
    });
    expect(conferirSegredo("curto", "", "outro")).toMatchObject({
      origem: "query",
      comprimento: 5,
    });
    expect(conferirSegredo("", "", "")).toMatchObject({ tipo: "recusado" });
  });

  it("allowlist de CNPJ compara só os dígitos; vazia aceita tudo", () => {
    expect(cnpjTransportadoraAceito("12345678000190", ["12.345.678/0001-90"])).toBe(true);
    expect(cnpjTransportadoraAceito("", ["12345678000190"])).toBe(false);
    expect(cnpjTransportadoraAceito("999", [])).toBe(true);
  });
});

describe("leitura do evento", () => {
  it("número sem DV e sem zero à esquerda; sigla do prefixo", () => {
    expect(normalizarNumeroCtrc("CAP033214-5")).toBe("33214");
    expect(normalizarNumeroCtrc("  -  ")).toBeNull();
    expect(siglaCtrc("cap1")).toBe("CAP");
    expect(siglaCtrc("123")).toBeNull();
  });

  it("data do SSW em Brasília, ISO sem fuso em Brasília e ISO com fuso", () => {
    expect(lerDataHoraSsw("5-11-2026 8:30:00")?.toISOString()).toBe("2026-11-05T11:30:00.000Z");
    expect(lerDataHoraSsw("2026-11-05T08:30:00")?.toISOString()).toBe("2026-11-05T11:30:00.000Z");
    expect(lerDataHoraSsw("2026-11-05T08:30:00Z")?.toISOString()).toBe("2026-11-05T08:30:00.000Z");
    expect(lerDataHoraSsw("ontem")).toBeNull();
  });

  it("lê o evento com a sigla e o CNPJ do remetente da chave", () => {
    const chave = "35261112345678000190550010000055011000055018";
    const lido = lerEventoSsw2181(corpo({ nf: { chaveNFe: chave } }));
    expect(lido).toMatchObject({
      tipo: "ok",
      evento: {
        numero: "33214",
        sigla: "CAP",
        fonteNumero: "cte",
        codigo: 85,
        chaveNfe: chave,
        cnpjRemetente: "12345678000190",
        numeroNfe: 5501,
        pedido: "PED-1",
      },
    });
  });

  it("numeroSSW quando numeroCTe vazio; NF quando não há CT-e", () => {
    const ssw = lerEventoSsw2181(corpo({ cte: { numeroCTe: "", numeroSSW: "77123" } }));
    expect(ssw).toMatchObject({ evento: { numero: "77123", sigla: null, fonteNumero: "cte" } });
    const nf = lerEventoSsw2181(corpo({ cte: { numeroCTe: "0", numeroSSW: "" } }));
    expect(nf).toMatchObject({ evento: { numero: "5501", fonteNumero: "nf" } });
  });

  it("valida número, código e data nesta ordem", () => {
    expect(lerEventoSsw2181({})).toMatchObject({ motivo: "ctrc_obrigatorio", status: 400 });
    expect(lerEventoSsw2181(corpo({ ocorrencia: { codigo: "100" } }))).toMatchObject({
      motivo: "codigo_invalido",
      descricao: "CODIGO DE OCORRENCIA INVALIDO",
    });
    expect(lerEventoSsw2181(corpo({ ocorrencia: { dataHoraEvento: "" } }))).toMatchObject({
      motivo: "data_invalida",
    });
  });
});

describe("casamento do CT-e", () => {
  const evento = (extra: Parameters<typeof corpo>[0] = {}) => {
    const lido = lerEventoSsw2181(corpo(extra));
    if (lido.tipo !== "ok") throw new Error("evento inválido no teste");
    return lido.evento;
  };

  it("só cria CT-e com número de CT-e, sigla, 4+ dígitos e diferente da NF", () => {
    expect(podeCriarCteDoWebhook(evento())).toBe(true);
    expect(podeCriarCteDoWebhook(evento({ cte: { numeroCTe: "0", numeroSSW: "" } }))).toBe(false);
    expect(podeCriarCteDoWebhook(evento({ cte: { numeroCTe: "33214" } }))).toBe(false);
    expect(podeCriarCteDoWebhook(evento({ cte: { numeroCTe: "CAP123" } }))).toBe(false);
    expect(podeCriarCteDoWebhook(evento({ cte: { numeroCTe: "CAP5501" } }))).toBe(false);
  });

  it("emissão do CT-e criado = dia de Brasília do evento, mesmo depois das 21h (Q11)", () => {
    const tarde = evento({ ocorrencia: { dataHoraEvento: "05-11-2026 22:30:00" } });
    expect(emissaoDoCteDoWebhook(tarde)).toBe("2026-11-05");
    const madrugada = evento({ ocorrencia: { dataHoraEvento: "06-11-2026 00:10:00" } });
    expect(emissaoDoCteDoWebhook(madrugada)).toBe("2026-11-06");
  });

  it("sem sigla vale a série de emissão mais recente", () => {
    const cas = { sigla: "CAS", dataEmissao: "2026-03-01" };
    const cap = { sigla: "CAP", dataEmissao: "2026-09-10" };
    expect(cteVigente([cas, cap])).toBe(cap);
    expect(cteVigente([])).toBeNull();
  });
});

describe("resposta ao SSW", () => {
  it("formato de lista com retorno e status de erro", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    expect(respostaSsw2181(401, "X", agora, { motivo: "m" })).toEqual([
      {
        retorno: {
          codigo: 401,
          descricao: "X",
          numeroNFe: 0,
          pedido: "",
          dataHora: "2026-11-10T12:00:00.000Z",
          protocolo: "",
          motivo: "m",
        },
      },
    ]);
    expect([401, 503, 500, 202, 404].map(statusHttpDoErro)).toEqual([401, 503, 500, 400, 400]);
  });

  it("protocolo base 36 de até 16 caracteres", () => {
    const p = gerarProtocolo(new Date("2026-11-10T12:00:00Z"), () => 0.5);
    expect(p).toHaveLength(14);
    expect(p).toMatch(/^[0-9a-z]+$/);
  });
});

describe("candidatosDaCredencial", () => {
  const segredo = "k".repeat(48);
  it("traz o token do header, o ?secret= e o trecho do caso 'contém'", () => {
    const embrulhado = `pre-${"0".repeat(22)}${segredo}`;
    expect(candidatosDaCredencial(`Bearer ${segredo}`, "", [])).toContain(segredo);
    expect(candidatosDaCredencial("", "q-secreto", [])).toEqual(["q-secreto"]);
    expect(candidatosDaCredencial(embrulhado, "", [48])).toContain(segredo);
    expect(candidatosDaCredencial(embrulhado, "", [])).not.toContain(segredo);
  });

  it("tem teto de candidatos e ignora comprimentos curtos demais para 'contém'", () => {
    expect(candidatosDaCredencial("x".repeat(5000) + "y", "", [32]).length).toBeLessThanOrEqual(
      128,
    );
    expect(candidatosDaCredencial("abcdefghij", "", [4])).toEqual(["abcdefghij"]);
  });
});
