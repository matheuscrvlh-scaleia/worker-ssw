/**
 * Leitor do relatório SSW 050 — "Relação das Coletas" (programa ssw0157), nos dois formatos:
 *
 * - impresso (download manual): um bloco de texto por coleta, colunas de largura fixa, histórico
 *   (SIT/INSTR) do mais recente para o mais antigo, datas sem ano (o ano sai da emissão);
 * - CSV do FTP: uma linha por coleta, `;`, cabeçalho na 1ª linha, datas com ano.
 *
 * Função pura: usada pela importação manual (API) e pela ingestão do FTP (worker).
 * origem: src/features/coletas/parse-050.ts (sistema atual)
 */
import { ErroDeNegocio } from "../errors";

interface EventoDaColeta {
  /** ISO com o fuso de São Paulo (-03:00). */
  em: string | null;
  unidade: string;
  usuario: string;
  texto: string;
}

export interface Coleta050 {
  unidade: string;
  numero: number;
  tipo: string;
  remetenteCnpj: string | null;
  remetenteNome: string | null;
  remetenteCidade: string | null;
  setor: string | null;
  destinatarioCnpj: string | null;
  destinatarioNome: string | null;
  destinoCidade: string | null;
  solicitante: string | null;
  motorista: string | null;
  placa: string | null;
  situacao: string | null;
  situacaoEm: string | null;
  limiteEm: string | null;
  limiteInicial: string | null;
  cadastradaEm: string | null;
  cadastradaPor: string | null;
  diaCadastro: string | null;
  comandadaEm: string | null;
  coletadaEm: string | null;
  canceladaEm: string | null;
  valorMercadoria: number | null;
  volumes: number | null;
  pesoKg: number | null;
  mercadoria: string | null;
  tipoFrete: string | null;
  notasFiscais: string | null;
  observacao: string | null;
  cteSigla: string | null;
  cteNumero: string | null;
  romaneio: string | null;
  prejudicadaHorario: boolean;
  historico: EventoDaColeta[];
}

/** Linha TOTAL do quadro "R E S U M O" no fim do impresso (conferência). */
interface Resumo050 {
  quantidade: number;
  cadastradas: number;
  comandadas: number;
  coletadas: number;
  canceladas: number;
  noPrazo: number;
  atrasadas: number;
}

interface PeriodoDoRelatorio {
  inicio: string;
  fim: string;
}

interface AvisoDeLeitura {
  linha: number;
  motivo: string;
}

export interface Relatorio050 {
  emitidoEm: string;
  periodoCadastro: PeriodoDoRelatorio | null;
  periodoColeta: PeriodoDoRelatorio | null;
  coletas: Coleta050[];
  resumo: Resumo050 | null;
  avisos: AvisoDeLeitura[];
}

const RE_EMISSAO = /^ssw0157\s+RELACAO DAS COLETAS\s+(\d\d)\/(\d\d)\/(\d\d)\s+(\d\d):(\d\d)/;
const RE_PERIODO =
  /^PERIODO DE (CADASTRAMENTO|COLETA):\s*(\d\d\/\d\d\/\d\d)\s+A\s+(\d\d\/\d\d\/\d\d)/;
const RE_INICIO = /^([A-Z0-9]{3}) (\d{6}) - (\S+)(?:.*DATA LIMITE INICIAL:\s*(\d\d\/\d\d))?/;
const RE_EVENTO =
  /^\s*(?:SIT\/INSTR:)?\s*\S+ ([A-Z0-9]{3}) (\S+)\s+(\d\d\/\d\d) (\d\d:\d\d) ?(.*)$/;
const RE_DATA_HORA = /(\d\d\/\d\d) (\d\d:\d\d)/;
const RE_CABECALHO_CSV = /^\uFEFF?UNIDADE;COLETA;TIPO;/;
const RE_RESUMO_TOTAL =
  /^\s*TOTAL\s+[\d.,]+\s+(\d+)\s+[\d,]+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/;

const COLUNAS_CSV = [
  "UNIDADE",
  "COLETA",
  "TIPO",
  "DATA_LIMITE_INICIAL",
  "REME_CNPJ",
  "REME_NOME",
  "REME_CIDADE",
  "SETOR",
  "DEST_CNPJ",
  "DEST_NOME",
  "DEST_CIDADE",
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
  "COLETADA_EM",
  "CANCELADA_EM",
  "OBS1",
  "OBS2",
  "OBS3",
  "HISTORICO",
] as const;
type ColunaCsv = (typeof COLUNAS_CSV)[number];

const naoEhO050 = (detalhe: string) =>
  new ErroDeNegocio(
    "ENTRADA_INVALIDA",
    `Este arquivo não é o relatório 050 (Relação das Coletas) do SSW: ${detalhe}`,
  );

/** É um 050 (impresso ou CSV do FTP)? Olha só o começo do arquivo. */
export function pareceRelatorio050(conteudo: string): boolean {
  const inicio = conteudo.slice(0, 2000);
  return /^ssw0157\s+RELACAO DAS COLETAS/m.test(inicio) || RE_CABECALHO_CSV.test(inicio);
}

/** Grupo de captura obrigatório da expressão (sempre presente quando ela casa). */
const grupo = (m: RegExpExecArray, i: number): string => m[i] ?? "";

function limpar(valor: string | undefined | null): string | null {
  const texto = (valor ?? "").replace(/\s+/g, " ").trim();
  return texto === "" ? null : texto;
}

/** Nome truncado pelo SSW termina em "(..)" ou "..": tira a marca. */
function nome(valor: string | null): string | null {
  return limpar((valor ?? "").replace(/\s*\(\.\.\)\s*$/, "").replace(/\s*\.\.\s*$/, ""));
}

function entre(linha: string, de: string, ate?: string): string | null {
  const i = linha.indexOf(de);
  if (i < 0) return null;
  const inicio = i + de.length;
  const fim = ate ? linha.indexOf(ate, inicio) : -1;
  return linha.slice(inicio, fim >= 0 ? fim : undefined);
}

/** Número no formato brasileiro ("1.234,5"). */
function numeroBr(valor: string | null): number | null {
  const texto = (valor ?? "").trim();
  if (texto === "") return null;
  const n = Number(texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type Datador = (ddmm: string | null | undefined, hhmm?: string) => string | null;

/**
 * dd/mm + hh:mm → ISO em São Paulo. O ano é o (UTC) da emissão; se a data passar de 60 dias
 * depois da emissão, é do ano anterior (relatório de janeiro com coleta de dezembro).
 */
function criarDatador(emissao: Date): Datador {
  const ano = emissao.getUTCFullYear();
  const limite = emissao.getTime() + 60 * 86_400_000;
  return (ddmm, hhmm = "00:00") => {
    if (!ddmm) return null;
    const d = /^(\d\d)\/(\d\d)$/.exec(ddmm.trim());
    const h = /^(\d\d):(\d\d)$/.exec(hhmm.trim());
    if (!d || !h) return null;
    const iso = (a: number) => `${a}-${d[2]}-${d[1]}T${h[1]}:${h[2]}:00-03:00`;
    const valido = (a: number) => !Number.isNaN(new Date(iso(a)).getTime());
    const a = new Date(iso(ano)).getTime() > limite ? ano - 1 : ano;
    return valido(a) ? iso(a) : null;
  };
}

/** dd/mm/aa → AAAA-MM-DD. */
function dataCurta(ddmmaa: string): string {
  const [d, m, a] = ddmmaa.split("/");
  return `20${a}-${m}-${d}`;
}

/** "dd/mm/aaaa hh:mm" (ou só a data) → ISO em São Paulo. */
function dataCompleta(valor: string | null | undefined): string | null {
  const m = /^(\d\d)\/(\d\d)\/(\d{4})(?: (\d\d):(\d\d))?$/.exec((valor ?? "").trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4] ?? "00"}:${m[5] ?? "00"}:00-03:00`;
}

/** Endereço do REME/DEST: depois de "END:", CEP + cidade ficam nas colunas +55..+91. */
function cidadeDoEndereco(linha: string): string | null {
  const e = linha.indexOf(" END:");
  if (e < 0) return null;
  // O bairro pode encostar no CEP ("JARDIM MARAJO26410050 JAPERI"): corta pelo CEP quando houver.
  const largo = linha.slice(e + 45, e + 91);
  const cep = /\d{7,8} /.exec(largo);
  return limpar(cep ? largo.slice(cep.index + cep[0].length) : linha.slice(e + 55, e + 91));
}

function parte(linha: string, rotulo: "REME:" | "DEST:") {
  const valor = entre(linha, rotulo, " END:") ?? "";
  const m = /^\s*(\d{11,14})?\s*(.*)$/.exec(valor);
  return {
    cnpj: m?.[1] ?? null,
    nome: nome(m?.[2] ?? null),
    cidade: cidadeDoEndereco(linha),
  };
}

/** CT-e gerado, romaneio e "prejudicada pelo horário" saem do histórico (mais recente primeiro). */
function derivarDoHistorico(c: Coleta050): void {
  for (const evento of c.historico) {
    const cte = /CTRC GERADO: ([A-Z0-9]{3}) (\d+)-\d/.exec(evento.texto);
    if (cte && !c.cteSigla) {
      c.cteSigla = grupo(cte, 1);
      c.cteNumero = String(Number(cte[2]));
    }
    const romaneio = /ROMANEIO ([A-Z0-9]{3} [\d-]+) gerado/.exec(evento.texto);
    if (romaneio && !c.romaneio) c.romaneio = grupo(romaneio, 1);
    if (/PREJUDICADA PELO HORARIO/.test(evento.texto)) c.prejudicadaHorario = true;
  }
}

function tipoDaColeta(tipo: string | null): string {
  return (tipo ?? "").startsWith("REVERS") ? "REVERSA" : (tipo ?? "NORMAL");
}

function coletaVazia(unidade: string, numero: number, tipo: string): Coleta050 {
  return {
    unidade,
    numero,
    tipo,
    remetenteCnpj: null,
    remetenteNome: null,
    remetenteCidade: null,
    setor: null,
    destinatarioCnpj: null,
    destinatarioNome: null,
    destinoCidade: null,
    solicitante: null,
    motorista: null,
    placa: null,
    situacao: null,
    situacaoEm: null,
    limiteEm: null,
    limiteInicial: null,
    cadastradaEm: null,
    cadastradaPor: null,
    diaCadastro: null,
    comandadaEm: null,
    coletadaEm: null,
    canceladaEm: null,
    valorMercadoria: null,
    volumes: null,
    pesoKg: null,
    mercadoria: null,
    tipoFrete: null,
    notasFiscais: null,
    observacao: null,
    cteSigla: null,
    cteNumero: null,
    romaneio: null,
    prejudicadaHorario: false,
    historico: [],
  };
}

const eventoDoHistorico = (m: RegExpExecArray, data: Datador): EventoDaColeta => ({
  em: data(m[3], m[4]),
  unidade: grupo(m, 1),
  usuario: grupo(m, 2),
  texto: limpar(m[5]) ?? "",
});

/**
 * Hora de geração do CSV: vem no nome do arquivo do FTP (`050_coletas_2026-11-05_1330.csv`).
 * Sem nome no padrão, a data mais recente do próprio arquivo.
 */
function emissaoDoCsv(arquivo: string | null, datas: (string | null)[]): Date | null {
  const m = /(\d{4})-(\d\d)-(\d\d)_(\d\d)(\d\d)/.exec(arquivo ?? "");
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`);
  const instantes = datas.filter((d) => d !== null).map((d) => new Date(d).getTime());
  return instantes.length > 0 ? new Date(Math.max(...instantes)) : null;
}

function lerCsv(conteudo: string, arquivo: string | null): Relatorio050 {
  const linhas = conteudo.replace(/^\uFEFF/, "").split(/\r?\n/);
  const cabecalho = (linhas[0] ?? "").split(";").map((h) => h.trim());
  const indice = Object.fromEntries(
    COLUNAS_CSV.map((coluna) => {
      const i = cabecalho.indexOf(coluna);
      if (i < 0) {
        throw new ErroDeNegocio("ENTRADA_INVALIDA", `O CSV do 050 veio sem a coluna ${coluna}.`);
      }
      return [coluna, i];
    }),
  ) as Record<ColunaCsv, number>;

  const avisos: AvisoDeLeitura[] = [];
  // O SSW não usa aspas nesse CSV (conferido no arquivo de 05/11/2026): split simples por ";".
  const registros = linhas
    .map((texto, i) => ({ campos: texto.split(";"), linha: i + 1 }))
    .slice(1)
    .filter((r) => r.campos.length > 1);
  const bruto = (campos: string[], coluna: ColunaCsv) => campos[indice[coluna]];

  const emissao = emissaoDoCsv(
    arquivo,
    registros.flatMap((r) => [
      dataCompleta(bruto(r.campos, "DATA_SITUACAO_ATUAL")),
      dataCompleta(bruto(r.campos, "CADASTRADA_EM")),
    ]),
  );
  if (!emissao) {
    throw new ErroDeNegocio("ENTRADA_INVALIDA", "O CSV do 050 não tem nenhuma coleta com data.");
  }
  const data = criarDatador(emissao);

  const coletas: Coleta050[] = [];
  for (const { campos, linha } of registros) {
    if (campos.length < cabecalho.length) {
      avisos.push({ linha, motivo: `linha com ${campos.length} de ${cabecalho.length} colunas` });
      continue;
    }
    const v = (coluna: ColunaCsv) => limpar(bruto(campos, coluna));
    const unidade = v("UNIDADE");
    const numero = Number(v("COLETA"));
    if (!unidade || !Number.isFinite(numero) || numero <= 0) {
      avisos.push({ linha, motivo: "linha sem unidade ou número da coleta" });
      continue;
    }
    const cadastradaEm = dataCompleta(v("CADASTRADA_EM"));
    const c: Coleta050 = {
      ...coletaVazia(unidade, numero, tipoDaColeta(v("TIPO"))),
      remetenteCnpj: v("REME_CNPJ"),
      remetenteNome: nome(v("REME_NOME")),
      remetenteCidade: v("REME_CIDADE"),
      setor: v("SETOR"),
      destinatarioCnpj: v("DEST_CNPJ"),
      destinatarioNome: nome(v("DEST_NOME")),
      destinoCidade: v("DEST_CIDADE"),
      solicitante: v("SOLICITANTE"),
      motorista: v("MOTORISTA"),
      placa: v("VEICULO"),
      situacao: v("SITUACAO_ATUAL")?.toUpperCase() ?? null,
      situacaoEm: dataCompleta(v("DATA_SITUACAO_ATUAL")),
      limiteEm: dataCompleta(v("DATA_HORA_LIMITE")),
      limiteInicial: dataCompleta(v("DATA_LIMITE_INICIAL"))?.slice(0, 10) ?? null,
      cadastradaEm,
      cadastradaPor: v("CADASTRADA_POR"),
      diaCadastro: cadastradaEm?.slice(0, 10) ?? null,
      comandadaEm: dataCompleta(v("COMANDADA_EM")),
      coletadaEm: dataCompleta(v("COLETADA_EM")),
      canceladaEm: dataCompleta(v("CANCELADA_EM")),
      valorMercadoria: numeroBr(v("VALOR_MERCADORIA")),
      volumes: numeroBr(v("QTDE_VOLUMES")),
      pesoKg: numeroBr(v("PESO_KG")),
      mercadoria: v("MERCADORIA"),
      tipoFrete: v("TIPO_FRETE"),
      notasFiscais: v("NOTAS_FISCAIS"),
      observacao: limpar([v("OBS1"), v("OBS2"), v("OBS3")].filter(Boolean).join(" ")),
      historico: (bruto(campos, "HISTORICO") ?? "")
        .split(" | ")
        .map((evento) => RE_EVENTO.exec(evento))
        .filter((m) => m !== null)
        .map((m) => eventoDoHistorico(m, data)),
    };
    derivarDoHistorico(c);
    if (!c.cadastradaEm) {
      avisos.push({ linha, motivo: `coleta ${c.unidade} ${c.numero} sem data de cadastro` });
    }
    coletas.push(c);
  }

  const dias = coletas
    .map((c) => c.diaCadastro)
    .filter((d) => d !== null)
    .sort();
  const [inicio] = dias;
  const fim = dias.at(-1);
  return {
    emitidoEm: emissao.toISOString(),
    periodoCadastro: inicio && fim ? { inicio, fim } : null,
    periodoColeta: null,
    coletas,
    resumo: null,
    avisos,
  };
}

/** Cabeçalho do impresso: emissão e períodos, nas 20 primeiras linhas. */
function lerCabecalho(linhas: readonly string[]) {
  let emissao: Date | null = null;
  let periodoCadastro: PeriodoDoRelatorio | null = null;
  let periodoColeta: PeriodoDoRelatorio | null = null;
  for (const linha of linhas.slice(0, 20)) {
    const e = RE_EMISSAO.exec(linha);
    if (e && !emissao) emissao = new Date(`20${e[3]}-${e[2]}-${e[1]}T${e[4]}:${e[5]}:00-03:00`);
    const p = RE_PERIODO.exec(linha);
    if (p) {
      const periodo = { inicio: dataCurta(grupo(p, 2)), fim: dataCurta(grupo(p, 3)) };
      if (p[1] === "CADASTRAMENTO") periodoCadastro = periodo;
      else periodoColeta = periodo;
    }
  }
  if (!emissao || Number.isNaN(emissao.getTime())) {
    throw naoEhO050("o cabeçalho com a data de emissão não foi encontrado.");
  }
  return { emissao, periodoCadastro, periodoColeta };
}

function lerResumo(linha: string): Resumo050 | null {
  const t = RE_RESUMO_TOTAL.exec(linha);
  if (!t) return null;
  return {
    quantidade: Number(t[1]),
    cadastradas: Number(t[2]),
    comandadas: Number(t[3]),
    coletadas: Number(t[4]),
    canceladas: Number(t[5]),
    noPrazo: Number(t[6]),
    atrasadas: Number(t[7]),
  };
}

/** Uma linha do bloco de uma coleta (fora do histórico). Devolve false se não reconheceu. */
function lerLinhaDaColeta(c: Coleta050, linha: string, data: Datador): boolean {
  const t = linha.trimStart();
  const momento = (rotulo: string) => {
    const valor = entre(linha, rotulo);
    const m = valor ? RE_DATA_HORA.exec(valor) : null;
    return {
      em: m ? data(m[1], m[2]) : null,
      resto: valor && m ? valor.slice(m.index + 11) : "",
    };
  };

  if (t.startsWith("REME:")) {
    const p = parte(linha, "REME:");
    c.remetenteCnpj = p.cnpj;
    c.remetenteNome = p.nome;
    c.remetenteCidade = p.cidade;
    c.setor = limpar(entre(linha, "SETOR:"));
  } else if (t.startsWith("DEST:")) {
    const p = parte(linha, "DEST:");
    c.destinatarioCnpj = p.cnpj;
    c.destinatarioNome = p.nome;
    c.destinoCidade = p.cidade;
  } else if (t.startsWith("DATA/HORA LIMITE:")) {
    const limite = RE_DATA_HORA.exec(entre(linha, "DATA/HORA LIMITE:", "SOLICITANTE:") ?? "");
    c.limiteEm = limite ? data(limite[1], limite[2]) : null;
    c.solicitante = limpar(entre(linha, "SOLICITANTE:", "MOTORISTA:"));
    c.motorista = limpar(entre(linha, "MOTORISTA:", "SITUACAO ATUAL:"));
    const s = momento("SITUACAO ATUAL:");
    c.situacaoEm = s.em;
    c.situacao = limpar(s.resto)?.toUpperCase() ?? null;
  } else if (t.startsWith("VAL MERC:")) {
    c.valorMercadoria = numeroBr(entre(linha, "VAL MERC:", "QTDE VOL:"));
    c.volumes = numeroBr(entre(linha, "QTDE VOL:", "PESO(KG):"));
    c.pesoKg = numeroBr(entre(linha, "PESO(KG):", "VEICULO:"));
    c.placa = limpar(entre(linha, "VEICULO:", "CADASTRADA:"));
    const cadastro = momento("CADASTRADA:");
    c.cadastradaEm = cadastro.em;
    c.cadastradaPor = limpar(cadastro.resto);
    c.diaCadastro = cadastro.em?.slice(0, 10) ?? null;
  } else if (t.startsWith("MERC:")) {
    c.mercadoria = limpar(entre(linha, "MERC:", "TIPO FRETE:"));
    c.tipoFrete = limpar(entre(linha, "TIPO FRETE:", "NFISCAIS:"));
    c.notasFiscais = limpar(entre(linha, "NFISCAIS:", "COMANDADA:"));
    c.comandadaEm = momento("COMANDADA:").em;
  } else if (/^OBS[123]:/.test(t)) {
    const rotuloDireita = t.startsWith("OBS1:")
      ? "COLETADA:"
      : t.startsWith("OBS2:")
        ? "CANCELADA:"
        : null;
    const corte = rotuloDireita ? linha.lastIndexOf(rotuloDireita) : -1;
    const obs = limpar(linha.slice(linha.indexOf(":") + 1, corte >= 0 ? corte : undefined));
    if (obs) c.observacao = c.observacao ? `${c.observacao} ${obs}` : obs;
    if (rotuloDireita && corte >= 0) {
      const m = RE_DATA_HORA.exec(linha.slice(corte));
      const em = m ? data(m[1], m[2]) : null;
      if (rotuloDireita === "COLETADA:") c.coletadaEm = em;
      else c.canceladaEm = em;
    }
  } else {
    return false;
  }
  return true;
}

function lerImpresso(conteudo: string): Relatorio050 {
  // eslint-disable-next-line no-control-regex -- quebra de página e modo condensado da impressora
  const linhas = conteudo.replace(/[\x0c\x0f]/g, "").split(/\r?\n/);
  const { emissao, periodoCadastro, periodoColeta } = lerCabecalho(linhas);
  const data = criarDatador(emissao);
  const avisos: AvisoDeLeitura[] = [];
  const coletas: Coleta050[] = [];
  let atual: Coleta050 | null = null;
  let noHistorico = false;
  let noResumo = false;
  let resumo: Resumo050 | null = null;

  const fechar = () => {
    if (atual) {
      derivarDoHistorico(atual);
      coletas.push(atual);
    }
    atual = null;
    noHistorico = false;
  };

  linhas.forEach((linha, i) => {
    if (/R E S U M O/.test(linha)) {
      fechar();
      noResumo = true;
      return;
    }
    if (noResumo) {
      resumo = lerResumo(linha) ?? resumo;
      return;
    }
    const inicio = RE_INICIO.exec(linha);
    if (inicio) {
      fechar();
      atual = coletaVazia(grupo(inicio, 1), Number(inicio[2]), tipoDaColeta(grupo(inicio, 3)));
      atual.limiteInicial = inicio[4] ? (data(inicio[4])?.slice(0, 10) ?? null) : null;
      return;
    }
    const c: Coleta050 | null = atual;
    if (!c) return;
    const t = linha.trimStart();
    if (/^-{10,}$/.test(t.trimEnd()) || /^={10,}$/.test(t.trimEnd())) {
      noHistorico = false;
      return;
    }
    // Cabeçalho de página no meio do arquivo.
    if (/PAG:\s+\d+\s*$/.test(linha) || /^ssw0157/.test(t) || /^PERIODO DE/.test(t)) return;
    if (lerLinhaDaColeta(c, linha, data)) return;
    if (t.startsWith("SIT/INSTR:") || (noHistorico && t.length > 0)) {
      noHistorico = true;
      const evento = RE_EVENTO.exec(linha);
      if (evento) c.historico.push(eventoDoHistorico(evento, data));
      else if (t.length > 0 && !t.startsWith("SIT/INSTR:")) {
        avisos.push({
          linha: i + 1,
          motivo: `linha de histórico não reconhecida: ${t.slice(0, 80)}`,
        });
      }
    }
  });
  fechar();

  for (const c of coletas) {
    if (!c.cadastradaEm) {
      avisos.push({ linha: 0, motivo: `coleta ${c.unidade} ${c.numero} sem data de cadastro` });
    }
  }
  return {
    emitidoEm: emissao.toISOString(),
    periodoCadastro,
    periodoColeta,
    coletas,
    resumo,
    avisos,
  };
}

/**
 * Lê o 050 nos dois formatos. Arquivo que não é o 050 é recusado com mensagem para o operador.
 * `arquivo` (nome) dá a hora de geração do CSV do FTP.
 */
export function lerRelatorio050(conteudo: string, arquivo: string | null = null): Relatorio050 {
  return RE_CABECALHO_CSV.test(conteudo.slice(0, 200))
    ? lerCsv(conteudo, arquivo)
    : lerImpresso(conteudo);
}
