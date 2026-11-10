/**
 * Arquivo grande do FTP (o 455 chegou a trazer o mês inteiro, ~39 MB) é dividido em partes de até
 * 3 MB, cada uma com as linhas de cabeçalho (`0;` e `1;`) repetidas, gravadas de volta na pasta.
 * origem: supabase/functions/processar-ftp-xmls/index.ts dividirCsv / nomeParte (sistema atual)
 */
export const MAX_PARTE_BYTES = 3_000_000;

const QUEBRA = 10; // "\n"
const PONTO_E_VIRGULA = 59;
const ZERO = 48;
const UM = 49;

function concatenar(partes: readonly Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, p) => s + p.length, 0);
  const saida = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    saida.set(p, pos);
    pos += p.length;
  }
  return saida;
}

export function dividirCsv(bytes: Uint8Array, maxBytes = MAX_PARTE_BYTES): Uint8Array[] {
  const linhas: Uint8Array[] = [];
  let inicio = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === QUEBRA) {
      linhas.push(bytes.subarray(inicio, i + 1));
      inicio = i + 1;
    }
  }
  if (inicio < bytes.length) linhas.push(bytes.subarray(inicio));
  const ehCabecalho = (l: Uint8Array) => l[1] === PONTO_E_VIRGULA && (l[0] === ZERO || l[0] === UM);
  const cabecalho = linhas.filter(ehCabecalho);
  const tamCabecalho = cabecalho.reduce((s, l) => s + l.length, 0);
  const partes: Uint8Array[] = [];
  let atual: Uint8Array[] = [];
  let tamanho = tamCabecalho;
  for (const l of linhas) {
    if (ehCabecalho(l)) continue;
    if (atual.length > 0 && tamanho + l.length > maxBytes) {
      partes.push(concatenar([...cabecalho, ...atual]));
      atual = [];
      tamanho = tamCabecalho;
    }
    atual.push(l);
    tamanho += l.length;
  }
  if (atual.length > 0) partes.push(concatenar([...cabecalho, ...atual]));
  return partes;
}

/** "455_csv_e_2026-10-27_1330.csv" → "455_csv_e_parte01_2026-10-27_1330.csv" (carimbo no fim). */
export function nomeParte(nome: string, i: number): string {
  const nn = String(i).padStart(2, "0");
  const m = /^(.*)_(\d{4}-\d{2}-\d{2}_\d{4}\.csv)$/i.exec(nome);
  return m
    ? `${m[1] ?? ""}_parte${nn}_${m[2] ?? ""}`
    : `${nome.replace(/\.csv$/i, "")}_parte${nn}.csv`;
}
