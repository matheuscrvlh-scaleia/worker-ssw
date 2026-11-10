/** Ordenação de texto igual ao `ORDER BY` do banco (collation en_US). */
const colador = new Intl.Collator("en-US", { sensitivity: "variant" });
export const compararTexto = (a: string, b: string): number => colador.compare(a, b);
