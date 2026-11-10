/**
 * Relatórios SSW que a ingestão lê. O 455 de largura fixa não é portado (Q44 do dono: não chega
 * desde 25/09/2026); o 455 vem só em CSV. O 050 (coletas) tem leitor próprio no domínio de coletas.
 */
export const RELATORIOS = ["036", "038", "306", "455csv", "930"] as const;
export type Relatorio = (typeof RELATORIOS)[number];

/** Linha que não pôde ser lida: vai para `ingestao_erros` e aparece na prévia da tela. */
export interface ErroDeLeitura {
  linha: number;
  texto: string;
  motivo: string;
}

/** Linha de dado lida, com o número da linha no arquivo. */
export interface LinhaLida<R> {
  linha: number;
  dados: R;
}

/** Resultado de um leitor: as linhas, os erros e a conferência do cabeçalho. */
export interface Analise<R> {
  registros: LinhaLida<R>[];
  erros: ErroDeLeitura[];
  /** `true` = o arquivo não é deste relatório (ou o layout mudou): não importar. */
  cabecalhoDivergente: boolean;
  cabecalhoDiferencas: string[];
}

/** Compara o cabeçalho encontrado com o esperado, coluna a coluna (mensagens do sistema atual). */
export function diferencasDeCabecalho(
  encontrado: readonly string[],
  esperado: readonly string[],
  quantidade = "Quantidade de colunas no cabeçalho",
): string[] {
  const diffs: string[] = [];
  if (encontrado.length !== esperado.length) {
    diffs.push(`${quantidade}: esperado ${esperado.length}, encontrado ${encontrado.length}.`);
  }
  esperado.forEach((nome, i) => {
    const atual = encontrado[i];
    if (atual == null) diffs.push(`Coluna ${i + 1}: esperado "${nome}", ausente no arquivo.`);
    else if (atual !== nome) {
      diffs.push(`Coluna ${i + 1}: esperado "${nome}", encontrado "${atual}".`);
    }
  });
  return diffs;
}
