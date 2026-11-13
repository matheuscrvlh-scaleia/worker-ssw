import { randomBytes } from "node:crypto";

import { lerChavesDeSegredo } from "@erp/db/secrets";
import { chaveDoTokenSsw } from "@erp/shared/ingestion";
import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";

import { BancoFalso, EMPRESA } from "../../testes/banco-falso";
import { type Cofre } from "../comum/integracao";
import { gerarToken, gerarTokenComNovasTentativas } from "./cliente";
import { criarCofreDeToken, geradoEmDoToken, type RedisDoCofre } from "./cofre-de-token";
import { criarJobTokenSsw } from "./job";

const log = pino({ level: "silent" });
const CREDENCIAIS = { dominio: "FRT", usuario: "api", senha: "s3nha", cnpjEdi: "12345678000190" };

type Rota = (url: string, init?: RequestInit) => { status: number; corpo: string };

function buscarFalso(rota: Rota) {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const buscar: typeof fetch = (entrada, init) => {
    const url =
      typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    chamadas.push({ url, ...(init ? { init } : {}) });
    const r = rota(url, init);
    return Promise.resolve(new Response(r.corpo, { status: r.status }));
  };
  return { buscar, chamadas };
}

function corpoEnviado(init: RequestInit | undefined): string {
  return typeof init?.body === "string" ? init.body : "";
}

function redisFalso(): RedisDoCofre & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return {
    dados,
    get: (k) => Promise.resolve(dados.get(k) ?? null),
    set: (k, v) => {
      dados.set(k, v);
      return Promise.resolve("OK");
    },
  };
}

describe("generateToken", () => {
  it("envia domain/username/password/cnpj_edi nesta ordem e aceita sucess (sic)", async () => {
    const { buscar, chamadas } = buscarFalso(() => ({
      status: 200,
      corpo: JSON.stringify({ sucess: true, token: "tok-123" }),
    }));
    expect(await gerarToken(buscar, CREDENCIAIS)).toEqual({ tipo: "ok", token: "tok-123" });
    expect(chamadas[0]?.url).toBe("https://ssw.inf.br/api/generateToken");
    expect(Object.keys(JSON.parse(corpoEnviado(chamadas[0]?.init)) as object)).toEqual([
      "domain",
      "username",
      "password",
      "cnpj_edi",
    ]);
  });

  it("token em dados.token; recusa vira auth_failed; 'cliente sem acesso' vira permission_denied", async () => {
    const dados = buscarFalso(() => ({
      status: 200,
      corpo: JSON.stringify({ success: true, dados: { token: "tok-9" } }),
    }));
    expect(await gerarToken(dados.buscar, CREDENCIAIS)).toEqual({ tipo: "ok", token: "tok-9" });
    const recusa = buscarFalso(() => ({
      status: 200,
      corpo: JSON.stringify({ sucess: false, message: "Usuario/senha invalido" }),
    }));
    expect(await gerarToken(recusa.buscar, CREDENCIAIS)).toMatchObject({
      tipoFalha: "auth_failed",
      mensagem: "Usuario/senha invalido",
    });
    const sem = buscarFalso(() => ({
      status: 200,
      corpo: JSON.stringify({ sucess: false, message: "Cliente sem acesso" }),
    }));
    expect(await gerarToken(sem.buscar, CREDENCIAIS)).toMatchObject({
      tipoFalha: "permission_denied",
    });
  });

  it("SSW fora: 3 tentativas com esperas de 1 s e 3 s", async () => {
    const { buscar, chamadas } = buscarFalso(() => ({ status: 522, corpo: "error code: 522" }));
    const esperas: number[] = [];
    const r = await gerarTokenComNovasTentativas(buscar, CREDENCIAIS, (ms) => {
      esperas.push(ms);
      return Promise.resolve();
    });
    expect(r).toMatchObject({ tipo: "falha", tipoFalha: "upstream_unavailable" });
    expect(chamadas).toHaveLength(3);
    expect(esperas).toEqual([1_000, 3_000]);
  });
});

describe("job verificar-token-ssw", () => {
  const chaves = lerChavesDeSegredo(`1:${randomBytes(32).toString("base64")}`, 1);
  const cofre: Cofre = { decifrar: () => "s3nha" };
  let banco: BancoFalso;
  let agora: Date;

  beforeEach(() => {
    banco = new BancoFalso();
    agora = new Date("2026-11-10T12:00:00Z");
    banco.integracoes.set("ssw_api", {
      ativo: true,
      parametros: { dominio: "frt", usuario: "api", cnpj_edi: "12.345.678/0001-90" },
      segredo: { cifrado: "x", versaoChave: 1 },
      dominioSswDaEmpresa: "FRT",
    });
  });

  function rodar(rota: Rota, redis: RedisDoCofre, manual = false) {
    const { buscar, chamadas } = buscarFalso(rota);
    const job = criarJobTokenSsw({
      buscar,
      cofre,
      tokens: criarCofreDeToken(redis, chaves),
      esperar: () => Promise.resolve(),
    });
    const resultado = job.processar(
      {
        executar: (fn) =>
          banco.executar({ empresaId: null, usuarioId: null, plataforma: true }, fn),
        empresaId: null,
        log,
        agora: () => agora,
      },
      { empresaId: EMPRESA, manual },
    );
    return { resultado, chamadas };
  }

  const ssw: Rota = (url) =>
    url.endsWith("/generateToken")
      ? { status: 200, corpo: JSON.stringify({ sucess: true, token: "token-novo-123" }) }
      : { status: 200, corpo: JSON.stringify({ sucess: true }) };

  it("sem token: gera, guarda cifrado no Redis, testa no consultaCep e registra a verificação", async () => {
    const redis = redisFalso();
    const { resultado, chamadas } = rodar(ssw, redis);
    expect(await resultado).toEqual({
      ok: true,
      renovado: true,
      mensagem: "Token renovado com sucesso via generateToken.",
      tipoFalha: null,
      tokenPrevia: "toke…-123",
    });
    expect(chamadas.map((c) => c.url)).toEqual([
      "https://ssw.inf.br/api/generateToken",
      "https://ssw.inf.br/api/consultaGenerica/consultaCep?idCep=80000000",
    ]);
    const guardado = redis.dados.get(chaveDoTokenSsw(EMPRESA)) ?? "";
    expect(guardado).not.toContain("token-novo-123");
    // A situação pedida pelo ERP lê só quando foi gerado, sem decifrar.
    expect(await geradoEmDoToken(redis, EMPRESA)).toEqual(agora);
    expect(await geradoEmDoToken(redis, "outra")).toBeNull();
    expect(banco.verificacoes).toMatchObject([{ tipo: "ssw_api", ok: true }]);
  });

  it("token com mais de 90 min de validade não é renovado (o manual sempre renova)", async () => {
    const redis = redisFalso();
    await rodar(ssw, redis).resultado;
    agora = new Date(agora.getTime() + 2 * 3_600_000);
    const automatico = rodar(ssw, redis);
    expect(await automatico.resultado).toMatchObject({
      ok: true,
      renovado: false,
      mensagem: "Token válido, expira em 120 min. Sem renovação.",
    });
    expect(automatico.chamadas).toEqual([]);
    expect(await rodar(ssw, redis, true).resultado).toMatchObject({ renovado: true });
  });

  it("falhas viram mensagem para a tela; integração desligada não chama o SSW", async () => {
    const recusa = rodar(
      () => ({ status: 200, corpo: JSON.stringify({ sucess: false, message: "senha errada" }) }),
      redisFalso(),
    );
    expect(await recusa.resultado).toMatchObject({
      ok: false,
      mensagem: "Falha ao renovar token SSW (auth_failed): senha errada",
      tipoFalha: "auth_failed",
    });
    const cep = rodar(
      (url) =>
        url.endsWith("/generateToken")
          ? { status: 200, corpo: JSON.stringify({ sucess: true, token: "tok-abcdefgh" }) }
          : { status: 401, corpo: JSON.stringify({ message: "Sessao invalida" }) },
      redisFalso(),
    );
    expect(await cep.resultado).toMatchObject({
      ok: false,
      renovado: true,
      mensagem: "Token gerado mas smoke test falhou: token_invalido - Sessao invalida",
    });

    banco.integracoes.clear();
    const desligada = rodar(ssw, redisFalso());
    expect(await desligada.resultado).toMatchObject({ ok: false });
    expect(desligada.chamadas).toEqual([]);
  });
});
