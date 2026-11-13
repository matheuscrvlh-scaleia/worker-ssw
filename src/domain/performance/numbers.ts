/**
 * `ROUND(num/den, casas)` do Postgres (meio para longe de zero) sem erro de ponto flutuante:
 * a conta é feita em inteiros. Só para `num, den >= 0`.
 */
export function arredondarRazao(num: number, den: number, casas: number): number {
  const escala = 10 ** casas;
  return Math.floor((2 * num * escala + den) / (2 * den)) / escala;
}

/** `ROUND(x, casas)` do Postgres para um valor já calculado (meio para longe de zero). */
export function arredondar(valor: number, casas: number): number {
  const escala = 10 ** casas;
  const sinal = valor < 0 ? -1 : 1;
  // O épsilon corrige representações como 2.675 → 2.67499999…
  return (sinal * Math.round(Math.abs(valor) * escala + 1e-9)) / escala;
}

/** `numeric` do banco (texto) em centavos inteiros: soma de dinheiro sem acumular float. */
export function centavos(valor: string | number | null | undefined): number {
  if (valor === null || valor === undefined || valor === "") return 0;
  const texto = typeof valor === "number" ? valor.toFixed(2) : valor;
  const negativo = texto.trim().startsWith("-");
  const [inteiro = "0", fracao = ""] = texto.replace("-", "").trim().split(".");
  const total = Number(inteiro) * 100 + Number(fracao.padEnd(2, "0").slice(0, 2));
  return negativo ? -total : total;
}

export function reais(centavosInteiros: number): number {
  return centavosInteiros / 100;
}

/** Soma de valores em reais feita em centavos inteiros (como o `sum(numeric)` do banco). */
export function somarReais(valores: Iterable<number>): number {
  let total = 0;
  for (const v of valores) total += centavos(v);
  return reais(total);
}

/** Razão ou nulo quando o denominador é zero. */
export function razao(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}
