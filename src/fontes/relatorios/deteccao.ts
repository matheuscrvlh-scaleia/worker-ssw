/**
 * Qual relatório é um arquivo: o nome sugere (`038_pendentes_ARA_2026-11-10_0930.csv`), o
 * cabeçalho decide. Bytes: tenta latin-1 (FTP) e depois UTF-8 (upload manual).
 * origem: src/features/ssw/server/detectar-relatorio.server.ts (sistema atual)
 */
import { ler036, type Registro036 } from "./r036";
import { ler038, type Registro038 } from "./r038";
import { ler306, type Registro306 } from "./r306";
import { ler455Csv, type Registro455Csv } from "./r455csv";
import { ler930, type Registro930 } from "./r930";
import { type Analise, type Relatorio, RELATORIOS } from "./tipos";

/** Linha lida de cada relatório, discriminada pelo código. */
export type AnaliseDoRelatorio =
  | { relatorio: "036"; analise: Analise<Registro036> }
  | { relatorio: "038"; analise: Analise<Registro038> }
  | { relatorio: "306"; analise: Analise<Registro306> }
  | { relatorio: "455csv"; analise: Analise<Registro455Csv> }
  | { relatorio: "930"; analise: Analise<Registro930> };

export function lerRelatorio(relatorio: Relatorio, conteudo: string): AnaliseDoRelatorio {
  switch (relatorio) {
    case "036":
      return { relatorio, analise: ler036(conteudo) };
    case "038":
      return { relatorio, analise: ler038(conteudo) };
    case "306":
      return { relatorio, analise: ler306(conteudo) };
    case "455csv":
      return { relatorio, analise: ler455Csv(conteudo) };
    case "930":
      return { relatorio, analise: ler930(conteudo) };
  }
}

const RE_NOME = /^(\d{3})_([a-z0-9_]*?)_?(?:([A-Z]{2,4})_)?(\d{4}-\d{2}-\d{2})_(\d{4})\.csv$/i;

export interface DeteccaoPeloNome {
  relatorio: Relatorio | null;
  /** Sigla da unidade (só o 038 é por unidade). */
  unidade: string | null;
  /** `aaaa-mm-dd_hhmm` do carimbo do nome. */
  cicloChave: string | null;
}

/** O 455 só chega em CSV: o código "455" do nome sugere o leitor de CSV. */
function relatorioDoCodigo(codigo: string): Relatorio | null {
  if (codigo === "455") return "455csv";
  return RELATORIOS.find((r) => r === codigo) ?? null;
}

export function detectarPeloNome(nome: string): DeteccaoPeloNome {
  const m = RE_NOME.exec(nome.trim());
  if (!m) return { relatorio: null, unidade: null, cicloChave: null };
  const [, codigo = "", , unidade, dia = "", hora = ""] = m;
  return {
    relatorio: relatorioDoCodigo(codigo),
    unidade: unidade ? unidade.toUpperCase() : null,
    cicloChave: `${dia}_${hora}`,
  };
}

export interface Deteccao extends DeteccaoPeloNome {
  /** Relatório confirmado pelo cabeçalho (a fonte da verdade); `null` = nenhum leitor aceitou. */
  confirmado: AnaliseDoRelatorio | null;
  divergenciaNomeCabecalho: boolean;
  motivo: string | null;
}

/** Testa primeiro o relatório sugerido pelo nome e depois os demais, na ordem de `RELATORIOS`. */
export function detectarRelatorio(nome: string, conteudo: string): Deteccao {
  const base = detectarPeloNome(nome);
  const ordem = base.relatorio
    ? [base.relatorio, ...RELATORIOS.filter((r) => r !== base.relatorio)]
    : [...RELATORIOS];
  for (const relatorio of ordem) {
    const lido = lerRelatorio(relatorio, conteudo);
    if (!lido.analise.cabecalhoDivergente) {
      return {
        ...base,
        confirmado: lido,
        divergenciaNomeCabecalho: base.relatorio != null && base.relatorio !== relatorio,
        motivo: null,
      };
    }
  }
  return {
    ...base,
    confirmado: null,
    divergenciaNomeCabecalho: false,
    motivo:
      "Nenhum parser reconheceu o cabeçalho do arquivo (possível arquivo corrompido ou layout alterado no SSW).",
  };
}

export type Codificacao = "iso-8859-1" | "utf-8";

/** Mesma detecção a partir dos bytes; sem leitor que aceite, devolve a evidência bruta. */
export function detectarRelatorioBytes(
  nome: string,
  bytes: Uint8Array,
): Deteccao & { conteudo: string; codificacao: Codificacao } {
  const textos = new Map<Codificacao, string>();
  for (const codificacao of ["iso-8859-1", "utf-8"] as const) {
    const conteudo = new TextDecoder(codificacao).decode(bytes);
    textos.set(codificacao, conteudo);
    const d = detectarRelatorio(nome, conteudo);
    if (d.confirmado) return { ...d, conteudo, codificacao };
  }
  const hex = Array.from(bytes.slice(0, 96))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  const amostra = [...textos]
    .map(([enc, t]) => `[${enc}] ${t.split(/\r?\n/).slice(0, 3).join(" ⏎ ").slice(0, 400)}`)
    .join(" || ");
  return {
    ...detectarPeloNome(nome),
    confirmado: null,
    divergenciaNomeCabecalho: false,
    motivo:
      `Nenhum parser reconheceu o cabeçalho (testado latin-1 e UTF-8). ` +
      `bytes=${bytes.length} hex[0..96]=${hex} · amostra: ${amostra}`,
    conteudo: textos.get("iso-8859-1") ?? "",
    codificacao: "iso-8859-1",
  };
}

/**
 * É um 050 (coletas: impresso ssw0157 ou CSV do FTP)? O 050 sai do ciclo e vai para coletas.
 * origem: src/features/coletas/parse-050.ts pareceRelatorio050 (sistema atual)
 */
export function pareceRelatorio050(conteudo: string): boolean {
  const inicio = conteudo.slice(0, 2000);
  return (
    /^ssw0157\s+RELACAO DAS COLETAS/m.test(inicio) || /^\uFEFF?UNIDADE;COLETA;TIPO;/.test(inicio)
  );
}
