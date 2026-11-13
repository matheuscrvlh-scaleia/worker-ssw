/**
 * Normalizações de texto do relatório 036 (romaneio) e constantes próprias do Romaneio.
 * Spec: docs/regras/03-romaneio-prazo-parceiro.md §0.2.
 */

/** "Saiu para entrega": 85 + eventos de rua (tentativa, recusa, ausente, retorno, 17...). */
export const CODIGOS_ROTA: readonly number[] = [
  85, 7, 9, 10, 13, 14, 17, 30, 31, 32, 33, 34, 38, 48, 63, 67, 70, 87, 88, 96,
];

export const CODIGO_SAIDA = 85;
export const CODIGO_RETORNO = 13;

/** Código de prejuízo: o filtro de códigos da tela, ou 13 sem filtro. origem: RPCs do romaneio */
export function codigosPrejuizo(codigos: readonly number[] | null | undefined): readonly number[] {
  return codigos && codigos.length > 0 ? codigos : [CODIGO_RETORNO];
}

/** Maiúsculas, só A–Z e 0–9; vazio → null. "kqk-6i98 " → "KQK6I98". origem: romaneio_norm_placa */
export function normPlaca(placa: string | null | undefined): string | null {
  const s = (placa ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s === "" ? null : s;
}

/**
 * Maiúsculas, espaços em sequência viram um, sem espaço nas pontas. A classe é a do `\s` do
 * Postgres (o `\s` do JS também casa NBSP). origem: romaneio_norm_nome
 */
export function normNome(nome: string | null | undefined): string | null {
  const s = (nome ?? "")
    .toUpperCase()
    .replace(/[ \t\n\r\f\v]+/g, " ")
    .replace(/^ +| +$/g, "");
  return s === "" ? null : s;
}

/** `trim(upper(nome))` sem juntar espaços internos (chave do ajudante). */
export function chaveAjudante(nome: string | null | undefined): string | null {
  const s = (nome ?? "").toUpperCase().trim();
  return s === "" ? null : s;
}

function semZerosAEsquerda(digitos: string): string {
  return digitos.replace(/^0+/, "");
}

/** Número do CT-e no texto do SSW ("CAP038984-6" → "38984"); sem dígitos (ou só zeros) → null. origem: ssw_num_ctrc */
export function sswNum(texto: string | null | undefined): string | null {
  const antes = (texto ?? "").split("-")[0] ?? "";
  const digitos = antes.replace(/\D/g, "");
  if (digitos === "") return null;
  const numero = semZerosAEsquerda(digitos);
  return numero === "" ? null : numero;
}

/** Sigla do CT-e no texto do SSW ("CAP038984-6" → "CAP"); sem letras → null. origem: ssw_sigla_ctrc */
export function sswSigla(texto: string | null | undefined): string | null {
  const letras = /^\s*([A-Za-z]+)/.exec(texto ?? "")?.[1];
  return letras ? letras.toUpperCase() : null;
}

/**
 * CT-e digitado no filtro da tela: "CAP038984-6" → { sigla: "CAP", numero: "38984" }. Com sigla
 * digitada, casa sigla e número (Q02); só número, casa qualquer série.
 * origem: get_romaneio_v3 (p_ctrc)
 */
export function ctrcDigitado(texto: string): { sigla: string | null; numero: string } {
  const limpo = texto.trim().toUpperCase();
  const sigla = /^([A-Z]+)/.exec(limpo)?.[1] ?? null;
  const resto = limpo.replace(/^[A-Z]+/, "");
  const digitos = (resto.split("-")[0] ?? "").replace(/\D/g, "");
  return { sigla, numero: semZerosAEsquerda(digitos) };
}

/** Número da NF digitado: só dígitos, sem zeros à esquerda; vazio → null. */
export function nfDigitada(texto: string): number | null {
  const digitos = semZerosAEsquerda(texto.replace(/\D/g, ""));
  return digitos === "" ? null : Number(digitos);
}

/**
 * Comparação de texto da collation do banco atual (en_US): acento e caixa só desempatam. Usada
 * em `max(texto)`, `string_agg ... ORDER BY` e opções ordenadas (docs/regras/00-ambiente.md).
 */
export const COLLATOR = new Intl.Collator("en-US", { sensitivity: "variant" });

/** `max(texto)` do SQL: ignora nulos; nenhum valor → null. */
export function maxTexto(valores: Iterable<string | null>): string | null {
  let maior: string | null = null;
  for (const v of valores) {
    if (v !== null && (maior === null || COLLATOR.compare(v, maior) > 0)) maior = v;
  }
  return maior;
}
