/**
 * Cliente do BI2 (API CSV do SSW): `https://ssw.inf.br/api/bi2/<DOMINIO>/<recurso>?codigo=&data=`,
 * `Authorization: Basic <token>`, corpo latin-1, 30 s de tempo limite.
 * Especificação: docs/regras/06-ingestao.md §3.14.
 */
export const BASE_DO_BI2 = "https://ssw.inf.br/api/bi2";
const TEMPO_LIMITE_MS = 30_000;

export type RecursoBi2 = "cliente";

/** Domínio do SSW da empresa (ex.: FRT): 2 a 10 letras/números. Erro = texto para o operador. */
export function normalizarDominioSsw(dominio: string | null): string {
  const d = (dominio ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(d)) {
    throw new Error(
      d
        ? `Domínio SSW inválido: "${d}".`
        : "Domínio SSW da empresa não configurado (Plataforma → Empresa → Dados).",
    );
  }
  return d;
}

/** "2026-11-10" → "20261110". */
export function dataDoBi2(dia: string): string {
  return dia.replaceAll("-", "");
}

export function urlDoRelatorio(dominio: string, recurso: RecursoBi2, codigo: string, dia: string) {
  return `${BASE_DO_BI2}/${normalizarDominioSsw(dominio)}/${recurso}?codigo=${codigo}&data=${dataDoBi2(dia)}`;
}

export type RespostaDoBi2 =
  | { tipo: "ok"; texto: string }
  | { tipo: "http"; status: number; corpo: string }
  | { tipo: "falha"; mensagem: string };

export type Buscar = typeof fetch;

/** Baixa o relatório. Nunca lança: falha de rede ou tempo vira `falha` (o job registra). */
export async function buscarRelatorioBi2(
  buscar: Buscar,
  entrada: { url: string; token: string },
): Promise<RespostaDoBi2> {
  try {
    const resposta = await buscar(entrada.url, {
      headers: { Authorization: `Basic ${entrada.token}` },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    const texto = new TextDecoder("latin1").decode(await resposta.arrayBuffer());
    if (resposta.status !== 200) return { tipo: "http", status: resposta.status, corpo: texto };
    return { tipo: "ok", texto };
  } catch (erro) {
    return { tipo: "falha", mensagem: erro instanceof Error ? erro.message : String(erro) };
  }
}

export interface CsvDoBi2 {
  cabecalho: string[];
  /** Cada linha de dado: valor por nome de coluna em minúsculas. */
  linhas: { valor: (coluna: string) => string | undefined; bruto: Record<string, string> }[];
  /** Corpo vazio, "9" ou sem dado. */
  vazio: boolean;
}

/**
 * CSV do BI2: `0;...` metadado, `1;...` cabeçalho, `2;`/`3;` dado; separador `;` sem aspas.
 * `bruto` = colunas não vazias (com trim), o que vai para `bi2_bruto`.
 * origem: parseBi2GenericCsv (src/features/bi2/server/bi2-generic-parser.server.ts)
 */
export function lerCsvBi2(texto: string): CsvDoBi2 {
  const limpo = texto.trim();
  if (limpo === "" || limpo === "9") return { cabecalho: [], linhas: [], vazio: true };
  let cabecalho: string[] = [];
  const dados: string[][] = [];
  for (const linha of limpo.replace(/\r\n/g, "\n").split("\n")) {
    const tipo = linha[0];
    if (tipo === "1")
      cabecalho = linha
        .split(";")
        .slice(1)
        .map((c) => c.trim());
    else if (tipo === "2" || tipo === "3") dados.push(linha.split(";").slice(1));
  }
  const indice = new Map(cabecalho.map((nome, i) => [nome.toLowerCase(), i]));
  const linhas = dados.map((valores) => {
    const bruto: Record<string, string> = {};
    cabecalho.forEach((nome, i) => {
      const v = valores[i]?.trim();
      if (nome && v) bruto[nome] = v;
    });
    return {
      valor: (coluna: string) => {
        const i = indice.get(coluna.toLowerCase());
        return i === undefined ? undefined : valores[i];
      },
      bruto,
    };
  });
  return { cabecalho, linhas, vazio: cabecalho.length === 0 || linhas.length === 0 };
}
