/**
 * Tipos e utilidades comuns das regras de aplicação: a linha do CT-e como a ingestão a lê e grava,
 * a linha de relatório guardada e as conversões de fuso.
 */
import { type ctes } from "@erp/db/schema";
import { type CteNucleo } from "@erp/dominio/nucleo";

/** Linha de `ctes` com os tipos do núcleo (ex.: `ocorrEfetivaFonte` fechado). */
export type CteDaIngestao = Omit<typeof ctes.$inferSelect, keyof CteNucleo> & CteNucleo;

/** Campos que a ingestão pode mudar num CT-e (identidade e empresa ficam de fora). */
export type CamposDoCte = Partial<Omit<CteDaIngestao, "id" | "empresaId" | "criadoEm">>;

/** Linha de relatório guardada em `ingestao_linhas`, já tipada pelo relatório. */
export interface LinhaGuardada<R> {
  id: number;
  loteId: string;
  importadoEm: Date;
  dados: R;
}

/** CT-e pela chave natural (Q02 do dono: sigla + número em todo lugar). */
export interface ChaveCte {
  sigla: string;
  numero: string;
}

export const chaveDoCte = (c: ChaveCte) => `${c.sigla}|${c.numero}`;

export function chaveDeTexto(texto: string): ChaveCte {
  const [sigla = "", numero = ""] = texto.split("|");
  return { sigla, numero };
}

// Brasília não tem horário de verão desde 2019: deslocamento fixo (igual ao núcleo).
const DESLOCAMENTO_SP = "-03:00";
const MS_SP = 3 * 3_600_000;
/** "aaaa-mm-ddThh:mm[:ss]" (hora de São Paulo, sem fuso) → instante. `zonedToUtc(x, SP)`. */
export function instanteSp(ingenuo: string): Date {
  const iso = ingenuo.replace(" ", "T");
  return new Date(`${iso.length === 16 ? `${iso}:00` : iso}${DESLOCAMENTO_SP}`);
}

/** Instante → "aaaa-mm-ddThh:mm:ss" em São Paulo (para comparar com a hora ingênua do SSW). */
export function ingenuoSp(instante: Date): string {
  return new Date(instante.getTime() - MS_SP).toISOString().slice(0, 19);
}

/** `trim` que devolve `null` no vazio. */
export function aparado(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

export function maiusculoAparado(v: string | null | undefined): string | null {
  return aparado(v)?.toUpperCase() ?? null;
}

export function digitosOuNulo(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  return d === "" ? null : d;
}

/** Maior valor (comparação de texto, como `max()` do SQL nos campos de texto). */
export function maximo<T extends string>(valores: readonly (T | null)[]): T | null {
  let maior: T | null = null;
  for (const v of valores) if (v !== null && (maior === null || v > maior)) maior = v;
  return maior;
}

export function minimo<T extends string>(valores: readonly (T | null)[]): T | null {
  let menor: T | null = null;
  for (const v of valores) if (v !== null && (menor === null || v < menor)) menor = v;
  return menor;
}

/** Ordena do mais novo para o mais antigo: `importado_em DESC, id DESC`. */
export function maisNovaPrimeiro<R>(a: LinhaGuardada<R>, b: LinhaGuardada<R>): number {
  return b.importadoEm.getTime() - a.importadoEm.getTime() || b.id - a.id;
}

/** Número para coluna `numeric(p, casas)` como o Postgres devolve (texto). */
export function paraNumeric(n: number | null, casas: number): string | null {
  return n === null ? null : n.toFixed(casas);
}

/** Igualdade de `numeric` gravado (texto) com um número, na escala da coluna. */
export function numericIgual(gravado: string | null, n: number | null, casas: number): boolean {
  if (gravado === null || n === null) return gravado === null && n === null;
  return Number(gravado) === Number(n.toFixed(casas));
}
