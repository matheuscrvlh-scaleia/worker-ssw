/**
 * Utilitários de texto, número e data dos relatórios SSW (spec 06 §2.1). Puros: servem ao
 * worker, à API e à prévia da tela de importação.
 */

/** Trim que também tira o espaço não-quebrável (U+00A0), comum nos arquivos do SSW. */
export function limpa(v: string | undefined): string {
  return (v ?? "").replace(/^[\s\u00A0]+|[\s\u00A0]+$/g, "");
}

/** Texto limpo ou `null` quando vazio. */
export function txt(v: string | undefined): string | null {
  const s = limpa(v);
  return s === "" ? null : s;
}

/** Número brasileiro: "10.753.951,07" → 10753951.07 (036, 455 CSV). */
export function numBR(v: string | undefined): number | null {
  const s = limpa(v).replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Número com ponto decimal (038): "1,5" vira `null` (fiel ao sistema atual). */
export function numPonto(v: string | undefined): number | null {
  const s = (v ?? "").trim().replace(/\s/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function truncar(n: number | null): number | null {
  return n == null ? null : Math.trunc(n);
}

/** Inteiro sem separador de milhar (qtde de volumes do 036). */
export function inteiroSemPontos(v: string | undefined): number | null {
  const s = limpa(v).replace(/[.\s]/g, "");
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** "dd/mm/aaaa" ou "dd/mm/aa" (século 20) → "aaaa-mm-dd". */
export function dataBR(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(limpa(v));
  if (!m) return null;
  const [, dia = "", mes = "", ano = ""] = m;
  return `${ano.length === 2 ? `20${ano}` : ano}-${mes}-${dia}`;
}

/** Só "dd/mm/aaaa" → "aaaa-mm-dd" (036, 038, 306). */
export function dataBR4(v: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(limpa(v));
  if (!m) return null;
  const [, dia = "", mes = "", ano = ""] = m;
  return `${ano}-${mes}-${dia}`;
}

/** Data + "h:mm|hh:mm" → "aaaa-mm-ddThh:mm:00" (hora de São Paulo, sem fuso). Hora ruim = 00:00. */
export function timestampBR(d: string | undefined, h: string | undefined): string | null {
  const data = dataBR(d);
  if (!data) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(limpa(h));
  const hh = (m?.[1] ?? "00").padStart(2, "0");
  const mm = m?.[2] ?? "00";
  return `${data}T${hh}:${mm}:00`;
}

/** Divide uma linha CSV com `;` respeitando aspas (com `""` escapando aspas dentro do campo). */
export function splitCsv(linha: string): string[] {
  const out: string[] = [];
  let atual = "";
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha.charAt(i);
    if (aspas) {
      if (c === '"' && linha.charAt(i + 1) === '"') {
        atual += '"';
        i++;
      } else if (c === '"') {
        aspas = false;
      } else {
        atual += c;
      }
    } else if (c === '"') {
      aspas = true;
    } else if (c === ";") {
      out.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  out.push(atual);
  return out;
}

/** Linhas do arquivo sem BOM, com CRLF/CR normalizados. */
export function linhasDoArquivo(conteudo: string): string[] {
  return conteudo
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
}

/** Compara nomes de coluna ignorando acento, caixa e espaços extras (455 CSV). */
export function normalizaCabecalho(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s\u00A0]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Número do CTRC: "CAP033214-5" → "33214" (só dígitos antes do DV, sem zero à esquerda).
 * origem: ssw_num_ctrc (sistema atual)
 */
export function numCtrc(ctrc: string | null): string | null {
  if (ctrc == null) return null;
  const digitos = (ctrc.trim().split("-")[0] ?? "").replace(/\D/g, "");
  if (digitos === "") return null;
  const semZeros = digitos.replace(/^0+/, "");
  return semZeros === "" ? null : semZeros;
}

/**
 * Sigla do CTRC: "cap033214-5" → "CAP".
 * origem: ssw_sigla_ctrc (sistema atual)
 */
export function siglaCtrc(ctrc: string | null): string | null {
  if (ctrc == null) return null;
  const m = /^([A-Za-z]+)/.exec(ctrc.trim());
  return m?.[1] ? m[1].toUpperCase() : null;
}

/** Código de ocorrência: só os dígitos como inteiro; vazio = `null`. */
export function codigoOcorrencia(texto: string | null): number | null {
  const d = (texto ?? "").replace(/\D/g, "");
  return d === "" ? null : Number.parseInt(d, 10);
}

/**
 * Unidade pela localização do 038: "FRT CAP - EM TRANSITO" → "CAP" (domínio "FRT").
 * origem: ssw_unidade_de_localizacao(loc, dominio) (sistema atual)
 */
export function unidadeDeLocalizacao(loc: string | null, dominio: string | null): string | null {
  const v = (loc ?? "").trim();
  if (!v) return null;
  let pref: string;
  const p = v.indexOf(" - ");
  if (p >= 0) pref = v.slice(0, p).trim();
  else {
    const q = v.indexOf("-");
    if (q < 0) return null;
    pref = v.slice(0, q).trim();
  }
  if (!pref) return null;
  const dom = (dominio ?? "").trim().toUpperCase();
  if (dom && pref.toUpperCase().startsWith(`${dom} `)) pref = pref.slice(dom.length + 1).trim();
  return pref || null;
}
