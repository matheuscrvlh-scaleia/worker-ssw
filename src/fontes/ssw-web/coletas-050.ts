/**
 * 050 (Relação das Coletas, ssw0157) impresso → CSV, uma linha por coleta. O SSW web só devolve
 * o relatório de impressão (um bloco de texto por coleta, colunas fixas); o CSV é o que o leitor
 * do 050 já lê do FTP (`@erp/domain/pickups/reader-050`).
 * origem: converter_050 e rel_050 do ssw-download (ssw_download.py), medidos em 05/11/2026
 */

export const CABECALHO_050 = [
  "UNIDADE",
  "COLETA",
  "TIPO",
  "DATA_LIMITE_INICIAL",
  "REME_CNPJ",
  "REME_NOME",
  "REME_ENDERECO",
  "REME_BAIRRO",
  "REME_CEP",
  "REME_CIDADE",
  "REME_FONE",
  "SETOR",
  "DEST_CNPJ",
  "DEST_NOME",
  "DEST_ENDERECO",
  "DEST_BAIRRO",
  "DEST_CEP",
  "DEST_CIDADE",
  "DEST_FONE",
  "DATA_HORA_LIMITE",
  "SOLICITANTE",
  "MOTORISTA",
  "SITUACAO_ATUAL",
  "DATA_SITUACAO_ATUAL",
  "VALOR_MERCADORIA",
  "QTDE_VOLUMES",
  "PESO_KG",
  "VEICULO",
  "MERCADORIA",
  "TIPO_FRETE",
  "NOTAS_FISCAIS",
  "CADASTRADA_EM",
  "CADASTRADA_POR",
  "COMANDADA_EM",
  "COMANDADA_POR",
  "COLETADA_EM",
  "COLETADA_POR",
  "CANCELADA_EM",
  "CANCELADA_POR",
  "OBS1",
  "OBS2",
  "OBS3",
  "HISTORICO",
] as const;

export type Coleta050Bruta = Record<(typeof CABECALHO_050)[number], string>;

/** Dia de referência para pôr ano nas datas `dd/mm` (o dia pedido ao SSW). */
export interface DiaDeReferencia {
  ano: number;
  mes: number;
  dia: number;
}

const RE_INICIO = /^([A-Z]{3}) (\d{6}) - (\S+)\s+DATA LIMITE INICIAL: (\S*)/;
const RE_DATA_HORA = /^(\d\d\/\d\d)(?: (\d\d:\d\d))?\s*(.*)$/;
const DIA_MS = 86_400_000;

const fatia = (linha: string, de: number, ate?: number) => linha.slice(de, ate).trim();
const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** `dd/mm` sem ano: fica o ano que deixa a data mais perto do dia de referência. */
function comAno(ddmm: string, ref: DiaDeReferencia): string {
  if (!/^\d\d\/\d\d$/.test(ddmm)) return ddmm;
  const dia = Number(ddmm.slice(0, 2));
  const mes = Number(ddmm.slice(3));
  const alvo = Date.UTC(ref.ano, ref.mes - 1, ref.dia);
  const candidatas = [ref.ano - 1, ref.ano, ref.ano + 1].filter((ano) => {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    return d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia; // 29/02 fora de ano bissexto
  });
  const ano = candidatas.reduce<number | null>((melhor, c) => {
    if (melhor === null) return c;
    const dist = (a: number) => Math.abs(Date.UTC(a, mes - 1, dia) - alvo) / DIA_MS;
    return dist(c) < dist(melhor) ? c : melhor;
  }, null);
  return ano === null ? ddmm : `${doisDigitos(dia)}/${doisDigitos(mes)}/${ano}`;
}

/** `'16/10 11:56 arthur'` → `['16/10/2026 11:56', 'arthur']`. */
function dataHoraResto(valor: string, ref: DiaDeReferencia): [string, string] {
  const m = RE_DATA_HORA.exec(valor.trim());
  if (!m) return ["", valor.trim()];
  const [, ddmm = "", hora, resto = ""] = m;
  return [comAno(ddmm, ref) + (hora ? ` ${hora}` : ""), resto.trim()];
}

/** Linhas REME:/DEST: em colunas fixas. */
function endereco(linha: string, prefixo: "REME" | "DEST"): Partial<Coleta050Bruta> {
  const cep = fatia(linha, 111, 119);
  return {
    [`${prefixo}_CNPJ`]: fatia(linha, 10, 24),
    [`${prefixo}_NOME`]: fatia(linha, 25, 56),
    [`${prefixo}_ENDERECO`]: fatia(linha, 61, 91),
    [`${prefixo}_BAIRRO`]: fatia(linha, 91, 111),
    // o SSW come o zero da frente do CEP
    [`${prefixo}_CEP`]: /^\d+$/.test(cep) ? cep.padStart(8, "0") : cep,
    [`${prefixo}_CIDADE`]: fatia(linha, 120, 146),
    [`${prefixo}_FONE`]: fatia(linha, 146, 162).replace("()-", ""),
  };
}

function coletaVazia(): Coleta050Bruta {
  return Object.fromEntries(CABECALHO_050.map((c) => [c, ""])) as Coleta050Bruta;
}

/**
 * Relatório impresso → coletas. Cada bloco começa em `ARA 056168 - NORMAL`; cabeçalho de página
 * (empresa, título, período, `=====`) é ignorado onde quer que caia, inclusive no meio do
 * histórico (SIT/INSTR), que vira uma coluna só, separada por ` | `.
 */
export function converterColetas050(texto: string, ref: DiaDeReferencia): Coleta050Bruta[] {
  const coletas: Coleta050Bruta[] = [];
  let atual: Coleta050Bruta | null = null;
  let historico: string[] = [];
  for (const linha of texto.split(/\r?\n/)) {
    const inicio = RE_INICIO.exec(linha);
    if (inicio) {
      const [, unidade = "", coleta = "", tipo = "", limite = ""] = inicio;
      atual = {
        ...coletaVazia(),
        UNIDADE: unidade,
        COLETA: coleta,
        TIPO: tipo,
        DATA_LIMITE_INICIAL: comAno(limite, ref),
      };
      historico = [];
      coletas.push(atual);
      continue;
    }
    if (atual === null) continue;
    const rotulo =
      linha.startsWith("    ") && linha[4] !== " "
        ? (linha.slice(4).split(":", 1)[0] ?? null)
        : null;
    const direita = linha.slice(169);
    if (rotulo === "REME") {
      Object.assign(atual, endereco(linha, "REME"), { SETOR: direita.trim() });
    } else if (rotulo === "DEST") {
      Object.assign(atual, endereco(linha, "DEST"));
    } else if (rotulo === "DATA/HORA LIMITE") {
      atual.DATA_HORA_LIMITE = dataHoraResto(linha.slice(22, 48), ref)[0];
      atual.SOLICITANTE = fatia(linha, 61, 84);
      atual.MOTORISTA = fatia(linha, 95, 153);
      [atual.DATA_SITUACAO_ATUAL, atual.SITUACAO_ATUAL] = dataHoraResto(direita, ref);
    } else if (rotulo === "VAL MERC") {
      atual.VALOR_MERCADORIA = fatia(linha, 14, 33);
      const volumes = fatia(linha, 43, 51).replaceAll(".", ""); // "1.600" -> 1600
      atual.QTDE_VOLUMES = /^\d+$/.test(volumes) ? String(Number(volumes)) : volumes;
      atual.PESO_KG = fatia(linha, 61, 86).replace(/,+$/, ""); // o SSW corta "51.500,"
      atual.VEICULO = fatia(linha, 95, 157);
      [atual.CADASTRADA_EM, atual.CADASTRADA_POR] = dataHoraResto(direita, ref);
    } else if (rotulo === "MERC") {
      atual.MERCADORIA = fatia(linha, 10, 49);
      atual.TIPO_FRETE = fatia(linha, 61, 85);
      atual.NOTAS_FISCAIS = fatia(linha, 95, 158);
      [atual.COMANDADA_EM, atual.COMANDADA_POR] = dataHoraResto(direita, ref);
    } else if (rotulo === "OBS1") {
      atual.OBS1 = fatia(linha, 10, 158);
      [atual.COLETADA_EM, atual.COLETADA_POR] = dataHoraResto(direita, ref);
    } else if (rotulo === "OBS2") {
      atual.OBS2 = fatia(linha, 10, 158);
      [atual.CANCELADA_EM, atual.CANCELADA_POR] = dataHoraResto(direita, ref);
    } else if (rotulo === "OBS3") {
      atual.OBS3 = fatia(linha, 10);
    } else if (
      rotulo === "SIT/INSTR" ||
      (historico.length > 0 && linha.startsWith(" ".repeat(15)) && linha.trim() !== "")
    ) {
      historico.push(linha.slice(15).trim().split(/\s+/).join(" "));
      atual.HISTORICO = historico.join(" | ");
    }
  }
  return coletas;
}

/** Junta as coletas sem repetir (unidade + número): a primeira vista fica. */
export function juntarColetas(listas: readonly (readonly Coleta050Bruta[])[]): Coleta050Bruta[] {
  const vistas = new Set<string>();
  return listas.flat().filter((c) => {
    const chave = `${c.UNIDADE}:${c.COLETA}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

function campoCsv(valor: string): string {
  return /[;"\r\n]/.test(valor) ? `"${valor.replaceAll('"', '""')}"` : valor;
}

/** Latin-1 (o que não cabe vira `?`), como os CSV que o SSW entrega. */
function latin1(texto: string): Uint8Array {
  return Uint8Array.from(texto, (c) => {
    const codigo = c.charCodeAt(0);
    return codigo <= 0xff ? codigo : 0x3f;
  });
}

/** CSV no formato dos que o SSW entrega: `;`, latin-1 e CRLF, cabeçalho na 1ª linha. */
export function csvDasColetas050(coletas: readonly Coleta050Bruta[]): Uint8Array {
  const linhas = [
    CABECALHO_050.join(";"),
    ...coletas.map((c) => CABECALHO_050.map((col) => campoCsv(c[col])).join(";")),
  ];
  return latin1(linhas.map((l) => `${l}\r\n`).join(""));
}
