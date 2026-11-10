/**
 * Ordenação de texto igual à do banco atual (collation `en_US.UTF-8`): ignora acento e caixa no
 * primeiro nível. Ver docs/regras/00-ambiente.md.
 */
const colacao = new Intl.Collator("en-US", { sensitivity: "variant" });

export function compararTexto(a: string, b: string): number {
  return colacao.compare(a, b);
}

/** Números grandes em texto (só dígitos): pelo valor, sem passar por `Number`. */
export function compararNumeroEmTexto(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** Comparador de chaves; nulo sempre por último, nos dois sentidos. */
export function compararComNulosNoFim<T>(
  a: T | null,
  b: T | null,
  comparar: (x: T, y: T) => number,
  direcao: "asc" | "desc",
): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const r = comparar(a, b);
  return direcao === "asc" ? r : -r;
}

export function compararNumero(a: number, b: number): number {
  return a - b;
}
