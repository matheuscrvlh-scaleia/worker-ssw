/**
 * Aba Hoje do Romaneio: romaneios emitidos no dia (data do romaneio no 036). Spec:
 * docs/regras/03-romaneio-prazo-parceiro.md §3.1.
 *
 * Decisões do dono: Q02 (a linha casa com o CT-e pela sigla + número quando a linha traz a sigla),
 * Q04 (a gaveta ordena antes de cortar), Q11 (85 válida desde 00:00 de Brasília) e Q18 (CT-e
 * cancelado ou cópia — fora do universo — não aparece).
 */
import {
  diaSp,
  estaEntregue,
  estaFinalizadoSemEntrega,
  inicioDoDiaSp,
  normCodigoOcorr,
} from "../core";
import { arredondar, somarReais } from "../performance/numbers";
import { CODIGO_SAIDA, COLLATOR, maxTexto, normPlaca, sswNum, sswSigla } from "./normalization";
import { type Cadastro, ehPenalizanteFR, type OcorrenciaDoCte } from "./status";

/** Linha do relatório 036 como a ingestão grava (campos usados aqui). */
export interface Linha036 {
  romaneio: string | null;
  ctrc: string | null;
  situacao: string | null;
  placa: string | null;
  motorista: string | null;
  ajudante: string | null;
  ajudante2: string | null;
  ajudante3: string | null;
  conferente: string | null;
  dataEmissao: string | null;
  horaEmissao: string | null;
  cidadeEntrega: string | null;
  bairro: string | null;
  codOcorrCtrc: string | null;
  descOcorrCtrc: string | null;
  dataOcorrCtrc: string | null;
  horaOcorrCtrc: string | null;
  importadoEm: Date;
}

/** CT-e casado com a linha do dia. */
export interface CteDoDia {
  id: string;
  sigla: string;
  numero: string;
  foraUniverso: boolean;
  dataEmissao: string;
  dataPrevista: string | null;
  dataEntregaRealizada: Date | null;
  criadoEm: Date;
  ocorrEfetivaCodigo: string | null;
  valorFrete: number;
  tipoDocumento: string | null;
  /** `unidadeResponsavel` do núcleo (sigla), já calculada. */
  unidadeResponsavel: string | null;
  numeroNf: number | null;
  destinatario: string | null;
  pagadorNome: string | null;
  cidadeDestino: string | null;
  ufDestino: string | null;
  ocorrencias: readonly OcorrenciaDoCte[];
}

export const SEM_TIPO = "__SEM_TIPO__";

export interface FiltrosDoDia {
  dia: string;
  filiais: readonly string[] | null;
  tipos: readonly string[] | null;
}

/** As linhas do 036 que valem para o dia: com CT-e e romaneio, não canceladas. */
export function linhasDoDia(linhas: readonly Linha036[], dia: string): Linha036[] {
  return linhas.filter(
    (l) =>
      l.dataEmissao === dia &&
      l.ctrc !== null &&
      l.romaneio !== null &&
      l.situacao !== "CANCELADO" &&
      sswNum(l.ctrc) !== null,
  );
}

/** DESC com nulos por último. */
function descNulosUltimo(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/** `(situacao = 'BAIXADO') DESC` do Postgres: nulo primeiro, depois true, depois false. */
function baixadoDesc(a: string | null, b: string | null): number {
  const peso = (s: string | null) => (s === null ? 0 : s === "BAIXADO" ? 1 : 2);
  return peso(a) - peso(b);
}

/** Ordem de escolha da linha "que vale" do CT-e no dia. */
function maisRelevantePrimeiro(a: Linha036, b: Linha036): number {
  return (
    descNulosUltimo(a.dataOcorrCtrc, b.dataOcorrCtrc) ||
    descNulosUltimo(a.horaOcorrCtrc, b.horaOcorrCtrc) ||
    baixadoDesc(a.situacao, b.situacao) ||
    descNulosUltimo(a.dataEmissao, b.dataEmissao) ||
    b.importadoEm.getTime() - a.importadoEm.getTime()
  );
}

/** Junção linha × CT-e: número igual e, se a linha traz sigla, sigla igual (Q02). */
function ctesDaLinha(l: Linha036, ctes: readonly CteDoDia[]): CteDoDia[] {
  const numero = sswNum(l.ctrc);
  const sigla = sswSigla(l.ctrc);
  return ctes.filter((c) => c.numero === numero && (sigla === null || c.sigla === sigla));
}

const tipoDaLinha = (c: CteDoDia | null) => c?.tipoDocumento?.trim().toUpperCase() || SEM_TIPO;

function passaNosFiltros(c: CteDoDia | null, f: FiltrosDoDia): boolean {
  if (
    f.tipos &&
    f.tipos.length > 0 &&
    !f.tipos.map((t) => t.toUpperCase()).includes(tipoDaLinha(c))
  )
    return false;
  if (f.filiais && f.filiais.length > 0)
    return c?.unidadeResponsavel != null && f.filiais.includes(c.unidadeResponsavel);
  return true;
}

/** 85 válida: fora de quarentena, a partir do dia da emissão, gravada depois do CT-e. Sem 85: null. */
function ok85(c: CteDoDia): boolean | null {
  const de85 = c.ocorrencias.filter((o) => o.codigo === CODIGO_SAIDA);
  if (de85.length === 0) return null;
  const corte = inicioDoDiaSp(c.dataEmissao);
  return de85.some((o) => !o.quarentena && o.dataHora >= corte && o.criadoEm >= c.criadoEm);
}

interface LinhaCasada {
  linha: Linha036;
  cte: CteDoDia | null;
  valorFrete: number;
  entregue: boolean;
  finalizado: boolean;
  emRota: boolean;
  prejudicada: boolean;
}

function casar(
  linhas: readonly Linha036[],
  ctes: readonly CteDoDia[],
  f: FiltrosDoDia,
  cadastro: Cadastro,
  codigosPrejuizo: readonly number[],
): LinhaCasada[] {
  const resultado: LinhaCasada[] = [];
  for (const linha of linhas) {
    const casados = ctesDaLinha(linha, ctes);
    const visiveis = casados.filter((c) => !c.foraUniverso);
    if (casados.length > 0 && visiveis.length === 0) continue; // Q18
    for (const cte of visiveis.length > 0 ? visiveis : [null]) {
      if (!passaNosFiltros(cte, f)) continue;
      const entregue = cte ? estaEntregue(cte.dataEntregaRealizada, cte.ocorrEfetivaCodigo) : false;
      const finalizado = cte
        ? estaFinalizadoSemEntrega(cte.dataEntregaRealizada, cte.ocorrEfetivaCodigo, cadastro.baixa)
        : false;
      const ocorr85 = cte !== null && normCodigoOcorr(cte.ocorrEfetivaCodigo) === CODIGO_SAIDA;
      resultado.push({
        linha,
        cte,
        valorFrete: cte?.valorFrete ?? 0,
        entregue,
        finalizado,
        emRota: ocorr85 && (ok85(cte) ?? true) && !entregue && !finalizado,
        prejudicada:
          cte !== null &&
          cte.ocorrencias.some(
            (o) =>
              codigosPrejuizo.includes(o.codigo) &&
              ehPenalizanteFR(cadastro, o.codigo) &&
              diaSp(o.dataHora) === f.dia,
          ),
      });
    }
  }
  return resultado;
}

/** Cada número de CT-e conta num romaneio só: o da linha mais recente. */
function umPorNumero(linhas: readonly LinhaCasada[]): LinhaCasada[] {
  const ordenadas = [...linhas].sort(
    (a, b) =>
      descNulosUltimo(a.linha.dataOcorrCtrc, b.linha.dataOcorrCtrc) ||
      descNulosUltimo(a.linha.horaOcorrCtrc, b.linha.horaOcorrCtrc) ||
      baixadoDesc(a.linha.situacao, b.linha.situacao) ||
      b.linha.importadoEm.getTime() - a.linha.importadoEm.getTime() ||
      COLLATOR.compare(b.linha.romaneio ?? "", a.linha.romaneio ?? ""),
  );
  const vistos = new Set<string>();
  return ordenadas.filter((x) => {
    const numero = sswNum(x.linha.ctrc) ?? "";
    if (vistos.has(numero)) return false;
    vistos.add(numero);
    return true;
  });
}

/** Cidade sem o "/UF" do fim, em maiúsculas. */
function cidadeDaRota(cidade: string | null): string | null {
  const s = (cidade ?? "")
    .toUpperCase()
    .replace(/\s*\/\s*[A-Z]{2}\s*$/, "")
    .trim();
  return s === "" ? null : s;
}

/** Junta valores contando repetições: mais frequente primeiro, depois alfabético. */
function juntarPorFrequencia(valores: readonly (string | null)[]): string | null {
  const contagem = new Map<string, number>();
  for (const v of valores) if (v !== null) contagem.set(v, (contagem.get(v) ?? 0) + 1);
  if (contagem.size === 0) return null;
  return [...contagem]
    .sort((a, b) => b[1] - a[1] || COLLATOR.compare(a[0], b[0]))
    .map(([v]) => v)
    .join(", ");
}

export interface LinhaRomaneioDoDia {
  romaneio: string;
  dataRomaneio: string;
  situacao: string | null;
  placa: string | null;
  motorista: string | null;
  ajudante: string | null;
  ajudante2: string | null;
  ajudante3: string | null;
  rota: string | null;
  bairros: string | null;
  ctes: number;
  frete: number;
  entregues: number;
  naoEntregues: number;
  performance: number | null;
  fretePerdido: number;
  prejudicadas: number;
}

export interface FaixasDePrazo {
  vencida: number;
  hoje: number;
  futuro: number;
  semPrev: number;
}

export interface ResumoDoDia {
  romaneios: number;
  ctes: number;
  entregues: number;
  frete: number;
  prejuizoFrete: number;
  prejuizoCtes: number;
  prazo: FaixasDePrazo;
  prazoNaoEntregue: FaixasDePrazo;
}

export type FaixaDoDia = "vencida" | "hoje" | "futuro" | "sem_prev";

function faixaDaPrevisao(prev: string | null, dia: string): FaixaDoDia {
  if (prev === null) return "sem_prev";
  if (prev < dia) return "vencida";
  return prev === dia ? "hoje" : "futuro";
}

const CHAVE_DA_FAIXA: Record<FaixaDoDia, keyof FaixasDePrazo> = {
  vencida: "vencida",
  hoje: "hoje",
  futuro: "futuro",
  sem_prev: "semPrev",
};

/**
 * Tabela e cards da aba Hoje. `linhas` = 036 do dia (já sem lotes parciais).
 * origem: romaneio_do_dia
 */
export function romaneioDoDia(
  linhas: readonly Linha036[],
  ctes: readonly CteDoDia[],
  f: FiltrosDoDia,
  cadastro: Cadastro,
  codigosPrejuizo: readonly number[],
): { linhas: LinhaRomaneioDoDia[]; resumo: ResumoDoDia } {
  // v: uma linha por (romaneio, número do CT-e).
  const porRomaneioNumero = new Map<string, Linha036>();
  for (const l of [...linhasDoDia(linhas, f.dia)].sort(maisRelevantePrimeiro)) {
    const chave = JSON.stringify([l.romaneio, sswNum(l.ctrc)]);
    if (!porRomaneioNumero.has(chave)) porRomaneioNumero.set(chave, l);
  }
  const r = casar([...porRomaneioNumero.values()], ctes, f, cadastro, codigosPrejuizo);
  const u = umPorNumero(r);

  const porRomaneio = new Map<string, LinhaCasada[]>();
  for (const x of r) {
    const rom = x.linha.romaneio ?? "";
    porRomaneio.set(rom, [...(porRomaneio.get(rom) ?? []), x]);
  }
  const tabela = [...porRomaneio].map(([romaneio, todas]): LinhaRomaneioDoDia => {
    const contam = u.filter((x) => x.linha.romaneio === romaneio);
    const entregues = contam.filter((x) => x.entregue).length;
    const ls = todas.map((x) => x.linha);
    const bairros = ls
      .map((l) => (l.bairro ?? "").toUpperCase().trim() || null)
      .filter((b) => b !== null && /[A-Z]/.test(b));
    return {
      romaneio,
      dataRomaneio: f.dia,
      situacao: maxTexto(ls.map((l) => l.situacao)),
      placa: maxTexto(ls.map((l) => normPlaca(l.placa))),
      motorista: maxTexto(ls.map((l) => l.motorista)),
      ajudante: maxTexto(ls.map((l) => l.ajudante)),
      ajudante2: maxTexto(ls.map((l) => l.ajudante2)),
      ajudante3: maxTexto(ls.map((l) => l.ajudante3)),
      rota: juntarPorFrequencia(ls.map((l) => cidadeDaRota(l.cidadeEntrega))),
      bairros: juntarPorFrequencia(bairros),
      ctes: contam.length,
      frete: somarReais(contam.map((x) => x.valorFrete)),
      entregues,
      naoEntregues: contam.length - entregues,
      performance: contam.length > 0 ? arredondar((100 * entregues) / contam.length, 1) : null,
      fretePerdido: somarReais(contam.filter((x) => x.prejudicada).map((x) => x.valorFrete)),
      prejudicadas: contam.filter((x) => x.prejudicada).length,
    };
  });
  tabela.sort((a, b) => b.ctes - a.ctes || COLLATOR.compare(a.romaneio, b.romaneio));

  const prazo: FaixasDePrazo = { vencida: 0, hoje: 0, futuro: 0, semPrev: 0 };
  const prazoNaoEntregue: FaixasDePrazo = { vencida: 0, hoje: 0, futuro: 0, semPrev: 0 };
  for (const x of u) {
    const chave = CHAVE_DA_FAIXA[faixaDaPrevisao(x.cte?.dataPrevista ?? null, f.dia)];
    prazo[chave] += 1;
    if (!x.entregue) prazoNaoEntregue[chave] += 1;
  }
  const prejudicadas = u.filter((x) => x.prejudicada);
  return {
    linhas: tabela,
    resumo: {
      romaneios: tabela.length,
      ctes: u.length,
      entregues: u.filter((x) => x.entregue).length,
      frete: somarReais(u.map((x) => x.valorFrete)),
      prejuizoFrete: somarReais(prejudicadas.map((x) => x.valorFrete)),
      prejuizoCtes: prejudicadas.length,
      prazo,
      prazoNaoEntregue,
    },
  };
}

export type StatusDoDia = "Entregue" | "Finalizado sem entrega" | "Em rota" | "Sem conclusão";

export interface CteDaFaixa {
  id: string | null;
  sigla: string | null;
  numero: string;
  numeroNf: number | null;
  romaneio: string | null;
  destinatario: string | null;
  pagador: string | null;
  cidadeDestino: string | null;
  ufDestino: string | null;
  dataEmissao: string | null;
  dataPrevista: string | null;
  status: StatusDoDia;
  placa: string | null;
}

/** Teto da gaveta: com mais CT-e que isso, mostra os primeiros pela ordem da tela. */
export const LIMITE_DA_GAVETA = 2000;

/**
 * CT-e do dia numa faixa de prazo. `apenasNaoEntregues` = aberta por "Em rota agora".
 * Ordena (previsão, número) e só então corta (Q04).
 * origem: romaneio_do_dia_ctrcs
 */
export function ctesDaFaixa(
  linhas: readonly Linha036[],
  ctes: readonly CteDoDia[],
  f: FiltrosDoDia,
  faixa: FaixaDoDia | "todas",
  apenasNaoEntregues: boolean,
  cadastro: Cadastro,
): { total: number; linhas: CteDaFaixa[] } {
  const porNumero = new Map<string, Linha036>();
  for (const l of [...linhasDoDia(linhas, f.dia)].sort(maisRelevantePrimeiro)) {
    const numero = sswNum(l.ctrc) ?? "";
    if (!porNumero.has(numero)) porNumero.set(numero, l);
  }
  const resultado: CteDaFaixa[] = [];
  for (const casada of casar([...porNumero.values()], ctes, f, cadastro, [])) {
    const { linha, cte } = casada;
    const prev = cte?.dataPrevista ?? null;
    if (faixa !== "todas" && faixaDaPrevisao(prev, f.dia) !== faixa) continue;
    const status: StatusDoDia = casada.entregue
      ? "Entregue"
      : casada.finalizado
        ? "Finalizado sem entrega"
        : cte !== null &&
            normCodigoOcorr(cte.ocorrEfetivaCodigo) === CODIGO_SAIDA &&
            (ok85(cte) ?? true)
          ? "Em rota"
          : "Sem conclusão";
    if (apenasNaoEntregues && status === "Entregue") continue;
    resultado.push({
      id: cte?.id ?? null,
      sigla: cte?.sigla ?? sswSigla(linha.ctrc),
      numero: cte?.numero ?? sswNum(linha.ctrc) ?? "",
      numeroNf: cte?.numeroNf ?? null,
      romaneio: linha.romaneio,
      destinatario: cte?.destinatario ?? null,
      pagador: cte?.pagadorNome ?? null,
      cidadeDestino: cte?.cidadeDestino ?? null,
      ufDestino: cte?.ufDestino ?? null,
      dataEmissao: cte?.dataEmissao ?? null,
      dataPrevista: prev,
      status,
      placa: normPlaca(linha.placa),
    });
  }
  resultado.sort(
    (a, b) =>
      (a.dataPrevista === b.dataPrevista
        ? 0
        : a.dataPrevista === null
          ? 1
          : b.dataPrevista === null
            ? -1
            : a.dataPrevista.localeCompare(b.dataPrevista)) || COLLATOR.compare(a.numero, b.numero),
  );
  return { total: resultado.length, linhas: resultado.slice(0, LIMITE_DA_GAVETA) };
}
