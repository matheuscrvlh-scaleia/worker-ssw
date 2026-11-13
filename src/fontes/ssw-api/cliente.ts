/**
 * Cliente da SSW API: `generateToken` (com novas tentativas quando o SSW está indisponível) e o
 * teste do token pelo `consultaCep`. Especificação: docs/regras/06-ingestao.md §3.18.
 */
import {
  type CredenciaisSsw,
  ehIndisponibilidadeSsw,
  tipoDaFalhaSsw,
  type TipoDeFalhaSsw,
} from "@erp/domain/ingestion/ssw-api";

const TEMPO_LIMITE_MS = 20_000;
/** Espera antes da 2ª e da 3ª tentativa quando o SSW está fora. */
const ESPERAS_MS = [1_000, 3_000];

export type Buscar = typeof fetch;

export interface RespostaDaSsw {
  status: number | null;
  texto: string;
  json: unknown;
}

async function chamar(
  buscar: Buscar,
  url: string,
  init: { method: "GET" | "POST"; body?: string; autorizacao?: string },
): Promise<RespostaDaSsw> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init.autorizacao) headers.set("Authorization", init.autorizacao);
  try {
    const resposta = await buscar(url, {
      method: init.method,
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    const texto = await resposta.text();
    return { status: resposta.status, texto, json: jsonOuNulo(texto) };
  } catch (erro) {
    return { status: null, texto: erro instanceof Error ? erro.message : String(erro), json: null };
  }
}

function jsonOuNulo(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

function campoTexto(objeto: unknown, nome: string): string | null {
  if (typeof objeto !== "object" || objeto === null) return null;
  const valor: unknown = Reflect.get(objeto, nome);
  return typeof valor === "string" && valor !== "" ? valor : null;
}

export type ResultadoDoToken =
  | { tipo: "ok"; token: string }
  | { tipo: "falha"; tipoFalha: TipoDeFalhaSsw; status: number | null; mensagem: string };

/**
 * `POST <base>/generateToken {domain, username, password, cnpj_edi}` (nesta ordem). A base vem da
 * integração (`baseDaSswApi`). Sucesso = `sucess`
 * (sic) ou `success` verdadeiro e token em `token`, `dados` ou `dados.token`.
 * origem: callGenerateToken (src/features/ssw/server/ssw-client.server.ts)
 */
export async function gerarToken(
  buscar: Buscar,
  base: string,
  c: CredenciaisSsw,
): Promise<ResultadoDoToken> {
  const r = await chamar(buscar, `${base}/generateToken`, {
    method: "POST",
    body: JSON.stringify({
      domain: c.dominio,
      username: c.usuario,
      password: c.senha,
      cnpj_edi: c.cnpjEdi,
    }),
  });
  const sucesso =
    typeof r.json === "object" &&
    r.json !== null &&
    (Reflect.get(r.json, "sucess") === true || Reflect.get(r.json, "success") === true);
  const dados: unknown =
    typeof r.json === "object" && r.json !== null ? Reflect.get(r.json, "dados") : null;
  const token =
    campoTexto(r.json, "token") ??
    (typeof dados === "string" ? dados : null) ??
    campoTexto(dados, "token");
  const indisponivel = ehIndisponibilidadeSsw(r.status, r.texto);
  if (sucesso && token && !indisponivel) return { tipo: "ok", token };
  const mensagem =
    campoTexto(r.json, "message") ??
    campoTexto(r.json, "mensagem") ??
    (indisponivel ? "SSW indisponível (timeout/rede)" : `HTTP ${r.status ?? "?"}`);
  return {
    tipo: "falha",
    tipoFalha: tipoDaFalhaSsw(r.status, r.texto || mensagem),
    status: r.status,
    mensagem,
  };
}

/** Até 3 tentativas, só quando o SSW está indisponível (esperas de 1 s e 3 s). */
export async function gerarTokenComNovasTentativas(
  buscar: Buscar,
  base: string,
  credenciais: CredenciaisSsw,
  esperar: (ms: number) => Promise<void>,
): Promise<ResultadoDoToken> {
  let resultado = await gerarToken(buscar, base, credenciais);
  for (const espera of ESPERAS_MS) {
    if (resultado.tipo === "ok" || resultado.tipoFalha !== "upstream_unavailable") return resultado;
    await esperar(espera);
    resultado = await gerarToken(buscar, base, credenciais);
  }
  return resultado;
}

/**
 * Teste do token: `GET <base>/consultaGenerica/consultaCep?idCep=80000000` com o token no header.
 * origem: testarTokenComCep (ssw-test.server.ts)
 */
export async function testarTokenComCep(
  buscar: Buscar,
  base: string,
  token: string,
): Promise<{ ok: boolean; diagnostico: string; mensagem: string }> {
  const r = await chamar(buscar, `${base}/consultaGenerica/consultaCep?idCep=80000000`, {
    method: "GET",
    autorizacao: token,
  });
  const mensagem = campoTexto(r.json, "message") ?? campoTexto(r.json, "mensagem") ?? "";
  if (ehIndisponibilidadeSsw(r.status, r.texto)) {
    return {
      ok: false,
      diagnostico: "upstream_indisponivel",
      mensagem: `SSW indisponível (HTTP ${r.status ?? "?"})`,
    };
  }
  if (/cliente sem acesso/i.test(mensagem)) {
    return { ok: false, diagnostico: "permissao_ssw2173_nao_liberada", mensagem };
  }
  if (r.status === 401 || /sess[aã]o\s+inv[aá]lida|token\s+inv[aá]lido/i.test(mensagem)) {
    return { ok: false, diagnostico: "token_invalido", mensagem: mensagem || "Token SSW inválido" };
  }
  if (r.status !== null && r.status >= 200 && r.status < 300) {
    return { ok: true, diagnostico: "token_valido", mensagem: mensagem || "OK" };
  }
  return {
    ok: false,
    diagnostico: "erro_desconhecido",
    mensagem: mensagem || `HTTP ${r.status ?? "?"}`,
  };
}
