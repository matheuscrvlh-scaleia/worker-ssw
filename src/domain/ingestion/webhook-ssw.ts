/**
 * Webhook SSW2181 (o SSW posta uma ocorrência por chamada em `/api/public/ssw-ocorrencias`):
 * autenticação pelo segredo da empresa, leitura do corpo e as regras de casamento do CT-e.
 * Puro: a API usa na recepção e o worker no processamento (e no reprocesso da tela).
 * Especificação: docs/regras/06-ingestao.md §3.17.
 */
import { somenteDigitos } from "../core/text";
import { type DataIso, diaSp } from "../core/time";

// --- Autorização ------------------------------------------------------------------------------

export type EsquemaAuthorization = "ausente" | "bearer" | "token" | "basic" | "raw";

/** Segredo menor que isto não vale por "contém" (o SSW às vezes embrulha o segredo no header). */
const MINIMO_PARA_CONTER = 32;

const semAspas = (valor: string) =>
  valor
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();

function acrescentar(tokens: string[], valor: string) {
  const token = semAspas(valor);
  if (token && !tokens.includes(token)) tokens.push(token);
}

/**
 * Candidatos a segredo no header `Authorization`: Bearer/Token (o resto), Basic (usuário, senha e
 * "usuário:senha" decodificados) ou o valor cru.
 * origem: extrairTokensAuthorization (src/routes/api/public/ssw-ocorrencias.ts)
 */
export function extrairTokensAuthorization(cabecalho: string | null | undefined): {
  esquema: EsquemaAuthorization;
  tokens: string[];
} {
  const auth = (cabecalho ?? "").trim();
  if (!auth) return { esquema: "ausente", tokens: [] };
  const tokens: string[] = [];
  if (/^bearer/i.test(auth)) {
    acrescentar(tokens, auth.replace(/^bearer\s*/i, ""));
    return { esquema: "bearer", tokens };
  }
  if (/^token/i.test(auth)) {
    acrescentar(tokens, auth.replace(/^token\s*/i, ""));
    return { esquema: "token", tokens };
  }
  if (/^basic/i.test(auth)) {
    const decodificado = decodificarBase64(semAspas(auth.replace(/^basic\s*/i, "")));
    if (decodificado !== null) {
      if (decodificado.includes(":")) {
        const [usuario = "", ...senha] = decodificado.split(":");
        acrescentar(tokens, usuario);
        acrescentar(tokens, senha.join(":"));
      }
      acrescentar(tokens, decodificado);
    }
    return { esquema: "basic", tokens };
  }
  acrescentar(tokens, auth);
  return { esquema: "raw", tokens };
}

/** Basic inválido: sem candidatos (sem expor o conteúdo). */
function decodificarBase64(texto: string): string | null {
  try {
    return atob(texto);
  } catch {
    return null;
  }
}

/** Comparação em tempo constante (não vaza, pelo tempo, quantos caracteres bateram). */
export function mesmoSegredo(recebido: string, esperado: string): boolean {
  if (recebido.length !== esperado.length || esperado === "") return false;
  let diferenca = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferenca |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  }
  return diferenca === 0;
}

/**
 * O segredo aparece dentro do header (o SSW manda um header de 74 caracteres com o segredo de 48
 * no meio). Só para segredo com 32 caracteres ou mais.
 * origem: headerContemSecret (sistema atual)
 */
export function headerContemSegredo(
  cabecalho: string | null | undefined,
  esperado: string,
): boolean {
  if (esperado.length < MINIMO_PARA_CONTER) return false;
  const auth = (cabecalho ?? "").trim();
  if (!auth) return false;
  const candidatos = new Set([auth, semAspas(auth), ...extrairTokensAuthorization(auth).tokens]);
  let achou = false;
  for (const c of candidatos) achou = contemEmTempoConstante(c, esperado) || achou;
  return achou;
}

/** `texto.includes(esperado)` sem saída antecipada: compara todas as janelas até o fim. */
function contemEmTempoConstante(texto: string, esperado: string): boolean {
  let achou = false;
  for (let i = 0; i + esperado.length <= texto.length; i++) {
    achou = mesmoSegredo(texto.slice(i, i + esperado.length), esperado) || achou;
  }
  return achou;
}

export type ResultadoDaAutorizacao =
  | { tipo: "ok" }
  | {
      tipo: "recusado";
      motivo: "token_incorreto";
      origem: "header" | "query";
      comprimento: number;
    };

/**
 * Confere o segredo esperado contra o header (exato ou contido) e o `?secret=`.
 * origem: handler POST de ssw-ocorrencias (sistema atual)
 */
export function conferirSegredo(
  esperado: string,
  cabecalho: string,
  segredoNaQuery: string,
): ResultadoDaAutorizacao {
  const { tokens } = extrairTokensAuthorization(cabecalho);
  const ok =
    esperado !== "" &&
    (tokens.some((t) => mesmoSegredo(t, esperado)) ||
      headerContemSegredo(cabecalho, esperado) ||
      mesmoSegredo(segredoNaQuery, esperado));
  if (ok) return { tipo: "ok" };
  const peloHeader = tokens.length > 0;
  return {
    tipo: "recusado",
    motivo: "token_incorreto",
    origem: peloHeader ? "header" : "query",
    comprimento: peloHeader ? Math.max(...tokens.map((t) => t.length)) : segredoNaQuery.length,
  };
}

/** Teto de candidatos por chamada (o header do SSW tem dezenas de caracteres, não milhares). */
const MAXIMO_DE_CANDIDATOS = 128;

/**
 * Tudo o que, na credencial recebida, pode ser o segredo: os candidatos do header, o header
 * inteiro, o `?secret=` e, para o caso "contém", cada trecho do header com o comprimento de um
 * segredo conhecido. Quem grava guarda só o SHA-256 de cada um (nunca o texto): no reprocesso,
 * o evento vale se o resumo do segredo atual ou do anterior estiver entre eles.
 */
export function candidatosDaCredencial(
  cabecalho: string,
  segredoNaQuery: string,
  comprimentosConhecidos: readonly number[],
): string[] {
  const auth = cabecalho.trim();
  const doHeader = auth
    ? [...new Set([auth, semAspas(auth), ...extrairTokensAuthorization(auth).tokens])]
    : [];
  const candidatos = new Set(doHeader);
  if (segredoNaQuery) candidatos.add(segredoNaQuery);
  for (const comprimento of new Set(comprimentosConhecidos)) {
    if (comprimento < MINIMO_PARA_CONTER) continue;
    for (const texto of doHeader) {
      for (let i = 0; i + comprimento <= texto.length; i++) {
        if (candidatos.size >= MAXIMO_DE_CANDIDATOS) return [...candidatos];
        candidatos.add(texto.slice(i, i + comprimento));
      }
    }
  }
  return [...candidatos];
}

/** `parametros.cnpjs_aceitos` como a tela grava (lista ou texto separado por vírgula). */
export function cnpjsAceitosDosParametros(valor: unknown): string[] {
  const itens = Array.isArray(valor) ? valor : typeof valor === "string" ? valor.split(",") : [];
  return itens.filter((i): i is string => typeof i === "string" && i.trim() !== "");
}

/**
 * Allowlist de CNPJ da transportadora (`parametros.cnpjs_aceitos` da integração). Vazia aceita
 * qualquer CNPJ.
 */
export function cnpjTransportadoraAceito(
  cnpjRecebido: string,
  aceitos: readonly string[],
): boolean {
  if (aceitos.length === 0) return true;
  return aceitos.map(somenteDigitos).includes(somenteDigitos(cnpjRecebido));
}

// --- Leitura do evento ------------------------------------------------------------------------

/**
 * Número do CTRC como o BI2 e o webhook gravam: antes do "-" (DV), só dígitos, sem zero à
 * esquerda. `parseInt` de propósito (igual ao sistema atual).
 * origem: normalizeNumeroCtrc (src/lib/ctrc.ts)
 */
export function normalizarNumeroCtrc(valor: unknown): string | null {
  const texto = textoDe(valor).trim();
  if (!texto) return null;
  const semDv = (texto.split("-")[0] ?? "").trim();
  const digitos = semDv.replace(/\D+/g, "");
  if (!digitos) return null;
  const numero = Number.parseInt(digitos, 10);
  return Number.isFinite(numero) ? String(numero) : null;
}

/** "cap033214-5" → "CAP"; sem letras no começo → `null`. origem: ssw_sigla_ctrc (SQL) */
export function siglaCtrc(valor: unknown): string | null {
  const letras = /^([A-Za-z]+)/.exec(textoDe(valor).trim())?.[1];
  return letras === undefined ? null : letras.toUpperCase();
}

/**
 * Data/hora do evento: "d-m-aaaa h:m:s" (Brasília), ISO sem fuso (Brasília) ou ISO com fuso.
 * origem: parseSswDateTime (sistema atual)
 */
export function lerDataHoraSsw(valor: unknown): Date | null {
  const texto = textoDe(valor).trim();
  if (!texto) return null;
  const br = /^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(texto);
  if (br) {
    const [, d = "", m = "", a = "", h = "", mi = "", s = ""] = br;
    return instanteValido(`${a}-${dois(m)}-${dois(d)}T${dois(h)}:${dois(mi)}:${dois(s)}-03:00`);
  }
  const ingenuo = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(texto);
  if (ingenuo) {
    const [, a = "", m = "", d = "", h = "", mi = "", s] = ingenuo;
    return instanteValido(`${a}-${m}-${d}T${h}:${mi}:${s ?? "00"}-03:00`);
  }
  return instanteValido(texto);
}

const dois = (parte: string) => parte.padStart(2, "0");

function instanteValido(texto: string): Date | null {
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data;
}

/** Ocorrência SSW2181 já lida e validada. */
export interface EventoSsw2181 {
  numero: string;
  /** Sigla do CT-e quando o número veio com ela (ex.: "CAP033214-5"); `null` = só o número. */
  sigla: string | null;
  /** `cte` = número do CT-e de verdade; `nf` = só sobrou o número da nota. */
  fonteNumero: "cte" | "nf";
  codigo: number;
  descricao: string | null;
  dataHora: Date;
  complemento: string | null;
  /** Chave da NF-e só quando tem 44 dígitos. */
  chaveNfe: string | null;
  numeroNfe: number;
  serieNfe: string | null;
  pedido: string;
  /** CNPJ do emitente da NF-e (dígitos 7 a 20 da chave), que é o remetente. */
  cnpjRemetente: string | null;
}

export type LeituraDoEvento =
  | { tipo: "ok"; evento: EventoSsw2181 }
  | { tipo: "falha"; status: 400; motivo: string; descricao: string };

/**
 * Lê o corpo do SSW2181. Número: `cte.numeroCTe`, senão `cte.numeroSSW` ("0" e vazio não contam),
 * senão `nf.numeroNFe`. Ordem das validações igual à de hoje: número, código, data.
 * origem: processarOcorrenciaSsw / extrairNumeroCtrcDetalhado (sistema atual)
 */
export function lerEventoSsw2181(corpo: unknown): LeituraDoEvento {
  const nf = objeto(campo(corpo, "nf"));
  const cte = objeto(campo(corpo, "cte"));
  const oc = objeto(campo(corpo, "ocorrencia"));
  const preenchido = (v: unknown) => {
    const s = textoDe(v).trim();
    return s && s !== "0" ? s : "";
  };
  const brutoCte = preenchido(cte.numeroCTe) || preenchido(cte.numeroSSW);
  const bruto = brutoCte || preenchido(nf.numeroNFe);
  const numero = bruto ? normalizarNumeroCtrc(bruto) : null;
  if (!numero) return falha("ctrc_obrigatorio", "NF/CTE OBRIGATORIO");
  const codigo = Number.parseInt(textoDe(oc.codigo), 10);
  if (!Number.isFinite(codigo) || codigo < 0 || codigo > 99) {
    return falha("codigo_invalido", "CODIGO DE OCORRENCIA INVALIDO");
  }
  const dataHora = lerDataHoraSsw(oc.dataHoraEvento);
  if (!dataHora) return falha("data_invalida", "DATA/HORA DO EVENTO INVALIDA");
  const chave = textoDe(nf.chaveNFe).trim();
  const chaveNfe = /^\d{44}$/.test(chave) ? chave : null;
  return {
    tipo: "ok",
    evento: {
      numero,
      sigla: brutoCte ? siglaCtrc(brutoCte) : null,
      fonteNumero: brutoCte ? "cte" : "nf",
      codigo,
      descricao: textoOuNulo(oc.descricao),
      dataHora,
      complemento: textoOuNulo(oc.complemento),
      chaveNfe,
      numeroNfe: numeroNfe(corpo),
      serieNfe: textoOuNulo(nf.serieNFe),
      pedido: pedido(corpo),
      cnpjRemetente: chaveNfe === null ? null : chaveNfe.slice(6, 20),
    },
  };
}

function falha(motivo: string, descricao: string): LeituraDoEvento {
  return { tipo: "falha", status: 400, motivo, descricao };
}

/** `nf.numeroNFe` como número (0 quando ausente), para a resposta ao SSW. */
export function numeroNfe(corpo: unknown): number {
  const n = Number(textoDe(objeto(campo(corpo, "nf")).numeroNFe) || 0);
  return Number.isFinite(n) ? n : 0;
}

/** `nf.pedido` como texto, para a resposta ao SSW. */
export function pedido(corpo: unknown): string {
  return textoDe(objeto(campo(corpo, "nf")).pedido);
}

/** CNPJ da transportadora do corpo, só dígitos. */
export function cnpjTransportadora(corpo: unknown): string {
  return somenteDigitos(textoDe(campo(corpo, "cnpjTransportadora")));
}

/**
 * CT-e desconhecido só é criado quando o número é de CT-e de verdade, tem 4+ dígitos, não é o
 * número da NF (o SSW às vezes manda a NF no campo do CT-e) **e** veio com a sigla: a identidade
 * do CT-e é sigla + número (Q02 do dono); hoje ele criava CT-e sem sigla.
 * origem: guard anti-fantasma de processarOcorrenciaSsw (sistema atual)
 */
export function podeCriarCteDoWebhook(evento: EventoSsw2181): boolean {
  if (evento.fonteNumero !== "cte" || evento.sigla === null || evento.numero.length < 4) {
    return false;
  }
  return !(evento.numeroNfe > 0 && Number(evento.numero) === evento.numeroNfe);
}

/**
 * Emissão do CT-e criado pelo webhook: o dia de Brasília do evento (Q11 do dono). Hoje era o dia
 * UTC (`dataHora.slice(0,10)`), que depois das 21h já caía no dia seguinte.
 */
export function emissaoDoCteDoWebhook(evento: EventoSsw2181): DataIso {
  return diaSp(evento.dataHora);
}

/**
 * Entre CT-e de séries diferentes com o mesmo número (o evento veio sem sigla), vale a série
 * vigente: a de emissão mais recente (Q02 do dono).
 */
export function cteVigente<T extends { dataEmissao: DataIso; sigla: string }>(
  candidatos: readonly T[],
): T | null {
  let vigente: T | null = null;
  for (const c of candidatos) {
    if (
      vigente === null ||
      c.dataEmissao > vigente.dataEmissao ||
      (c.dataEmissao === vigente.dataEmissao && c.sigla < vigente.sigla)
    ) {
      vigente = c;
    }
  }
  return vigente;
}

// --- Resposta ao SSW --------------------------------------------------------------------------

export interface RetornoSsw2181 {
  retorno: {
    codigo: number;
    descricao: string;
    numeroNFe: number;
    pedido: string;
    dataHora: string;
    protocolo: string;
    [extra: string]: unknown;
  };
}

/** Corpo de resposta no formato do SSW (lista de um elemento). */
export function respostaSsw2181(
  codigo: number,
  descricao: string,
  agora: Date,
  extras: { numeroNFe?: number; pedido?: string; protocolo?: string } & Record<
    string,
    unknown
  > = {},
): RetornoSsw2181[] {
  return [
    {
      retorno: {
        codigo,
        descricao,
        numeroNFe: 0,
        pedido: "",
        dataHora: agora.toISOString(),
        protocolo: "",
        ...extras,
      },
    },
  ];
}

/** Status HTTP de uma resposta de erro: 401, 503 e 500 passam; o resto vira 400. */
export function statusHttpDoErro(codigo: number): 400 | 401 | 500 | 503 {
  if (codigo === 401 || codigo === 500 || codigo === 503) return codigo;
  return 400;
}

/** Protocolo devolvido ao SSW e gravado na ocorrência (16 caracteres base 36). */
export function gerarProtocolo(agora: Date, aleatorio: () => number): string {
  const sufixo = Math.floor(aleatorio() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `${agora.getTime().toString(36)}${sufixo}`.slice(0, 16);
}

// --- Apoio ------------------------------------------------------------------------------------

function campo(valor: unknown, nome: string): unknown {
  return typeof valor === "object" && valor !== null ? Reflect.get(valor, nome) : undefined;
}

function objeto(valor: unknown): Record<string, unknown> {
  if (typeof valor !== "object" || valor === null) return {};
  return Object.fromEntries(Object.entries(valor));
}

function textoDe(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean" || typeof valor === "bigint") {
    return String(valor);
  }
  return "";
}

function textoOuNulo(valor: unknown): string | null {
  const s = textoDe(valor).trim();
  return s === "" ? null : s;
}
