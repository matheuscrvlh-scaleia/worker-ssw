/**
 * Utilidades de texto do núcleo: filtro "a|b", nomes, CNPJ/CPF e tipo de documento.
 */

/** `btrim` do Postgres: tira só espaço (' '), não tab nem quebra de linha. */
export function btrim(texto: string): string {
  return texto.replace(/^ +| +$/g, "");
}

/** `NULLIF(btrim(x), '')`. */
export function vazioAposTrim(texto: string | null): string | null {
  const t = btrim(texto ?? "");
  return t === "" ? null : t;
}

/** `NULLIF(x, '')` (sem trim). */
export function nuloSeVazio(texto: string | null): string | null {
  return texto === "" ? null : texto;
}

export function somenteDigitos(texto: string | null): string {
  return (texto ?? "").replace(/\D/g, "");
}

/**
 * Padrões ILIKE do filtro de texto com vários valores separados por `|` (Remetente, Destino).
 * `%`, `_` e `\` digitados continuam curingas, como hoje. A consulta usa
 * `col ILIKE ANY($padroes::text[])`.
 * origem: texto_casa_filtro (sistema atual)
 */
export function padroesTextoFiltro(filtro: string): string[] {
  const t = btrim(filtro);
  if (!filtro.includes("|")) return [`%${t}%`];
  return `%${t.replace(/\s*\|\s*/g, "%|%")}%`.split("|");
}

const ACENTUADOS = "áàãâäéèêëíìîïóòõôöúùûüçÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇ";
const SEM_ACENTO = "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC";

/**
 * Tira os acentos da lista e põe em maiúsculas (ñ não está na lista: vira Ñ).
 * origem: normalizar_nome (sistema atual)
 */
export function normalizarNome(texto: string | null): string {
  return (texto ?? "")
    .replace(new RegExp(`[${ACENTUADOS}]`, "g"), (ch) => SEM_ACENTO.charAt(ACENTUADOS.indexOf(ch)))
    .toUpperCase();
}

/**
 * CNPJ/CPF com máscara. CPF válido (11 dígitos, ou 14 começando com "000" como o 455 manda)
 * vence CNPJ; todo número de 14 dígitos sai com máscara de CNPJ, válido ou não; CNPJ
 * alfanumérico sai como veio, em maiúsculas.
 * origem: formatar_cnpj_cpf (sistema atual)
 */
export function formatarCnpjCpf(documento: string | null): string | null {
  const bruto = btrim(documento ?? "");
  if (/[A-Za-z]/.test(bruto)) return bruto.toUpperCase();
  const d = somenteDigitos(documento);
  if (d === "" || /^0+$/.test(d)) return null;
  if (d.length === 11 || (d.length === 14 && d.startsWith("000"))) {
    const cpf = d.slice(-11);
    if (cpfValido(cpf)) {
      return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    }
  }
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return d;
}

function cpfValido(cpf: string): boolean {
  const digito = (i: number) => Number(cpf.charAt(i));
  const verificador = (tamanho: number) => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += digito(i) * (tamanho + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return verificador(9) === digito(9) && verificador(10) === digito(10);
}

/**
 * Tipo do 455; sem ele, o do BI2; maiúsculas. Nulo vira "Sem tipo" (`__SEM_TIPO__`) nos filtros.
 * origem: tipo_documento_efetivo (sistema atual); decisão tipo-documento-pela-classificacao-do-455
 */
export function tipoDocumentoEfetivo(
  tipo455: string | null,
  tipoBi2: string | null,
): string | null {
  return (vazioAposTrim(tipo455) ?? vazioAposTrim(tipoBi2))?.toUpperCase() ?? null;
}
