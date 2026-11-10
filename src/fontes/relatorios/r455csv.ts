/**
 * 455 CSV — Expedidos e Recebidos com colunas configuráveis. `;` com aspas; `0;` título, `1;`
 * nomes das colunas, `2;` dado; demais linhas contam como ignoradas. Mapeamento **por nome**:
 * coluna desconhecida é só informada; esperada ausente vira `null`. Só é divergente sem `1;` ou
 * sem nenhuma coluna conhecida.
 * origem: src/features/ssw/server/parse-455-csv.server.ts (sistema atual)
 */
import { type Coluna455, COLUNAS_455_CSV, type Tipo455 } from "./colunas-455";
import {
  dataBR,
  limpa,
  linhasDoArquivo,
  normalizaCabecalho,
  numBR,
  splitCsv,
  truncar,
  txt,
} from "./texto";
import { type Analise, type ErroDeLeitura, type LinhaLida } from "./tipos";

export type Registro455Csv = Record<Coluna455, string | number | null>;

const POR_CABECALHO = new Map<string, { coluna: Coluna455; tipo: Tipo455 }>(
  COLUNAS_455_CSV.map((c) => [normalizaCabecalho(c.header), c]),
);

function converter(tipo: Tipo455, bruto: string | undefined): string | number | null {
  switch (tipo) {
    case "num":
      return numBR(bruto);
    case "int":
      return truncar(numBR(bruto));
    case "date":
      return dataBR(bruto);
    case "txt":
      return txt(bruto);
  }
}

function registroVazio(): Registro455Csv {
  return Object.fromEntries(COLUNAS_455_CSV.map((c) => [c.coluna, null])) as Registro455Csv;
}

export interface Analise455Csv extends Analise<Registro455Csv> {
  linhasIgnoradas: number;
}

export function ler455Csv(conteudo: string): Analise455Csv {
  const registros: LinhaLida<Registro455Csv>[] = [];
  const erros: ErroDeLeitura[] = [];
  const desconhecidas: string[] = [];
  // `as`: o forEach muda a variável; sem ele o TS a estreita para o valor inicial.
  let temCabecalho = false as boolean;
  let mapa: { idx: number; coluna: Coluna455; tipo: Tipo455 }[] = [];
  let ignoradas = 0;

  linhasDoArquivo(conteudo).forEach((linha, idx) => {
    if (!linha.trim()) return;
    if (linha.startsWith("1;")) {
      temCabecalho = true;
      mapa = [];
      splitCsv(linha)
        .slice(1)
        .forEach((h, i) => {
          const nome = limpa(h);
          if (!nome) return;
          const def = POR_CABECALHO.get(normalizaCabecalho(nome));
          if (def) mapa.push({ idx: i, ...def });
          else if (!desconhecidas.includes(nome)) desconhecidas.push(nome);
        });
      return;
    }
    if (!linha.startsWith("2;")) {
      ignoradas += 1;
      return;
    }
    if (mapa.length === 0) {
      erros.push({
        linha: idx + 1,
        texto: linha,
        motivo: "linha de dado antes da linha de cabeçalho de colunas (1;...)",
      });
      return;
    }
    const campos = splitCsv(linha).slice(1);
    const dados = registroVazio();
    for (const m of mapa) dados[m.coluna] = converter(m.tipo, campos[m.idx]);
    registros.push({ linha: idx + 1, dados });
  });

  const encontradas = new Set(mapa.map((m) => m.coluna));
  const ausentes = COLUNAS_455_CSV.filter((c) => !encontradas.has(c.coluna)).map((c) => c.header);
  const diferencas: string[] = [];
  if (!temCabecalho) {
    diferencas.push('Linha de cabeçalho de colunas ("1;Serie/Numero CTRC;...") não encontrada.');
  } else if (mapa.length === 0) {
    diferencas.push("Nenhuma coluna conhecida foi reconhecida no cabeçalho do arquivo.");
  } else {
    if (desconhecidas.length) {
      diferencas.push(`Colunas não reconhecidas (ignoradas): ${desconhecidas.join(", ")}.`);
    }
    if (ausentes.length) {
      diferencas.push(`Colunas não marcadas na exportação: ${ausentes.join(", ")}.`);
    }
  }
  return {
    registros,
    erros,
    linhasIgnoradas: ignoradas,
    // Só o que impede a leitura é divergente; colunas a mais ou a menos são informativas.
    cabecalhoDivergente: !temCabecalho || mapa.length === 0,
    cabecalhoDiferencas: diferencas,
  };
}

/** Texto de uma coluna do 455 (as colunas `txt`/`date` guardam texto). */
export function texto455(r: Registro455Csv, coluna: Coluna455): string | null {
  const v = r[coluna];
  return typeof v === "string" ? v : null;
}

/** Número de uma coluna do 455 (`num`/`int`). */
export function numero455(r: Registro455Csv, coluna: Coluna455): number | null {
  const v = r[coluna];
  return typeof v === "number" ? v : null;
}
