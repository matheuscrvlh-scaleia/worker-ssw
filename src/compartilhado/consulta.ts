import { ehDataIso } from "./datas";
import { z } from "./zod";

/*
 * Peças de schema para a query string dos GET. `?a=1&a=2` chega como array e `?a=1` como texto;
 * números e sim/não chegam como texto. Cada peça aceita o tipo de verdade (o web chama tipado) e
 * o texto da URL, e sempre devolve o tipo de verdade.
 */

/** Lista: aceita o array ou um valor solto (um item só na query string). */
export function lista<T extends z.ZodType>(item: T) {
  return z.union([z.array(item), item.transform((v) => [v])]);
}

export const inteiro = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/, "Número inteiro inválido.")
    .transform(Number)
    .pipe(z.number().int()),
]);

export const decimal = z.union([
  z.number(),
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/, "Número inválido.")
    .transform(Number),
]);

/** `"1"`/`"true"` = sim; `"0"`/`"false"` = não (o formato dos links de hoje é `"1"`). */
export const simNao = z.union([
  z.boolean(),
  z.enum(["1", "0", "true", "false"]).transform((v) => v === "1" || v === "true"),
]);

/** Data `AAAA-MM-DD`, com a mensagem que a tela mostra quando vem outra coisa. */
export const dataIsoComMensagem = (mensagem: string) => z.string().refine(ehDataIso, mensagem);

export const dataIso = dataIsoComMensagem("Data inválida (use AAAA-MM-DD).");

/** Lista do corpo de um POST: no máximo `maximo` itens; ausente = vazia (sem filtro). */
export function listaComTeto<T extends z.ZodType>(item: T, maximo: number) {
  return z.array(item).max(maximo).default([]);
}

/** Maior página aceita (teto contra deslocamento absurdo no banco). */
export const MAIOR_PAGINA = 100_000;

/**
 * Página pedida de toda lista paginada: `pagina` a partir de 1 e `tamanho` em linhas, até
 * `maximo` ou só uma das `opcoes` do seletor da tela. Aceita número ou texto (query string).
 */
export function paginacao(
  tamanho: ({ maximo: number } | { opcoes: readonly number[] }) & { padrao?: number },
) {
  const valido =
    "opcoes" in tamanho
      ? z
          .number()
          .refine(
            (n) => tamanho.opcoes.includes(n),
            `Tamanho de página: ${tamanho.opcoes.join(", ")}.`,
          )
      : z.number().min(1).max(tamanho.maximo);
  return {
    pagina: inteiro.pipe(z.number().min(1).max(MAIOR_PAGINA)).default(1),
    tamanho: inteiro.pipe(valido).default(tamanho.padrao ?? 50),
  };
}

/** Texto livre de filtro: tamanho limitado (vai para ILIKE). */
export const textoDeFiltro = z.string().max(200);
