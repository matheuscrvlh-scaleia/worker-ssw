/**
 * Projeções do Romaneio: tabelas de leitura que substituem as views materializadas de hoje
 * (`mv_romaneio_viagem_ctrc`, `romaneio_saida_ctrc`, `mv_romaneio_036_ctrc` +
 * `mv_romaneio_ctrc_motorista`, `mv_ctrc_staging_enriquecido`). Spec:
 * docs/regras/03-romaneio-prazo-parceiro.md §5.
 *
 * Recalculadas por CT-e (sigla + número, Q02) a partir das linhas de relatório que ainda estão
 * guardadas (`ingestao_linhas`, retenção de 60 dias). A projeção é o estado acumulado: o que não
 * tem mais linha (expirou) fica como está; só uma linha nova muda o que já foi projetado.
 *
 * Quando: logo depois da ingestão gravar as linhas (incremental, Q38: sem o atraso de até 30 min
 * dos minutos :15/:45 de hoje) e uma reconstrução completa de madrugada como conciliação.
 */
import { type Linha036 } from "./hoje";
import { COLLATOR, normNome, normPlaca, sswNum, sswSigla } from "./normalizacao";

export interface ChaveCte {
  sigla: string;
  numero: string;
}

export const chaveDoCte = (c: ChaveCte) => `${c.sigla}|${c.numero}`;

/** Linha do 306 (SSW Mobile) com os campos usados. */
export interface Linha306 {
  ctrcColeta: string | null;
  data: string | null;
  placa: string | null;
  motorista: string | null;
  importadoEm: Date;
}

/** Linha do 038 (pendentes) com os campos usados. */
export interface Linha038 {
  setor: string | null;
  bairro: string | null;
  endereco: string | null;
  cep: string | null;
  valorMercadoria: number | null;
  importadoEm: Date;
}

/** Linha do 455 (expedidos) com os campos usados. */
export interface Linha455 {
  valorMercadoria: number | null;
  importadoEm: Date;
}

/** Linhas de relatório de um CT-e (só as de lotes já importados). */
export interface LinhasDoCte {
  l036: readonly Linha036[];
  l306: readonly Linha306[];
  l038: readonly Linha038[];
  l455: readonly Linha455[];
}

// ---------------------------------------------------------------------------------------------
// 5.1 Viagens (CT-e × romaneio)

export interface ViagemProjetada {
  romaneio: string;
  situacao: string | null;
  dataSaida: string;
  horaSaida: string | null;
  placa: string | null;
  motorista: string | null;
  motoristaNormalizado: string | null;
  ajudante: string | null;
  ajudante2: string | null;
  ajudante3: string | null;
  primeira: boolean;
  ultima: boolean;
  proximaSaida: string | null;
}

const maisNovaPrimeiro = (a: { importadoEm: Date }, b: { importadoEm: Date }) =>
  b.importadoEm.getTime() - a.importadoEm.getTime();

/** `ASC NULLS FIRST` para texto. */
function ascNulosPrimeiro(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}

/**
 * Viagens do CT-e: por romaneio vale a linha importada por último; se ela está CANCELADO a
 * viagem sai. Romaneio sem linha guardada continua como estava. Depois reordena todas por
 * (saída, hora nula primeiro, romaneio) e recalcula primeira/última/próxima saída.
 * origem: mv_romaneio_viagem_ctrc
 */
export function viagensDoCte(
  linhas: readonly Linha036[],
  gravadas: readonly ViagemProjetada[],
): ViagemProjetada[] {
  const ultimaPorRomaneio = new Map<string, Linha036>();
  for (const l of [...linhas].sort(maisNovaPrimeiro)) {
    if (
      l.romaneio === null ||
      l.dataEmissao === null ||
      sswNum(l.ctrc) === null ||
      sswSigla(l.ctrc) === null
    )
      continue;
    if (!ultimaPorRomaneio.has(l.romaneio)) ultimaPorRomaneio.set(l.romaneio, l);
  }
  const viagens = new Map<string, Omit<ViagemProjetada, "primeira" | "ultima" | "proximaSaida">>();
  for (const v of gravadas) viagens.set(v.romaneio, v);
  for (const [romaneio, l] of ultimaPorRomaneio) {
    if (l.situacao === "CANCELADO" || l.dataEmissao === null) {
      viagens.delete(romaneio);
      continue;
    }
    viagens.set(romaneio, {
      romaneio,
      situacao: l.situacao,
      dataSaida: l.dataEmissao,
      horaSaida: l.horaEmissao,
      placa: normPlaca(l.placa),
      motorista: l.motorista,
      motoristaNormalizado: normNome(l.motorista),
      ajudante: l.ajudante,
      ajudante2: l.ajudante2,
      ajudante3: l.ajudante3,
    });
  }
  const ordenadas = [...viagens.values()].sort(
    (a, b) =>
      a.dataSaida.localeCompare(b.dataSaida) ||
      ascNulosPrimeiro(a.horaSaida, b.horaSaida) ||
      COLLATOR.compare(a.romaneio, b.romaneio),
  );
  return ordenadas.map((v, i) => ({
    ...v,
    primeira: i === 0,
    ultima: i === ordenadas.length - 1,
    proximaSaida: ordenadas[i + 1]?.dataSaida ?? null,
  }));
}

// ---------------------------------------------------------------------------------------------
// 5.4 Dias de saída

/**
 * Dias em que o CT-e saiu: basta UMA linha não cancelada no dia (de qualquer importação). Linha
 * cancelada nunca tira dia: hoje o gatilho só tira o dia quando a linha válida é apagada da
 * staging, e a linha válida que expirou daqui continua lá. Dia gravado só sai pelo descarte de
 * ciclo (`semODescartado`).
 * origem: romaneio_saida_ctrc (gatilho _romaneio_saida_ctrc_sync)
 */
export function saidasDoCte(linhas: readonly Linha036[], gravadas: readonly string[]): string[] {
  const dias = new Set(gravadas);
  for (const l of linhas) {
    if (l.dataEmissao !== null && sswNum(l.ctrc) !== null && l.situacao !== "CANCELADO") {
      dias.add(l.dataEmissao);
    }
  }
  return [...dias].sort();
}

// ---------------------------------------------------------------------------------------------
// 5.2 + 5.3 Romaneio atual (último 036, senão 306)

export interface Parte036 {
  romaneio: string | null;
  situacao: string | null;
  placa: string | null;
  motorista: string | null;
  ajudante: string | null;
  ajudante2: string | null;
  ajudante3: string | null;
  codOcorr: string | null;
  descOcorr: string | null;
  /** Data + hora (vazia = 12:00) da ocorrência do CT-e no 036, em horário de SP. */
  dataOcorr: Date | null;
  dataEmissao: string | null;
}

export interface Parte306 {
  placa: string | null;
  motorista: string | null;
  data: string | null;
}

export interface RomaneioAtual {
  /** Placa e motorista que as telas mostram: do 036; sem 036 (ou 036 sem placa), do 306. */
  placa: string | null;
  motorista: string | null;
  r036: Parte036 | null;
  r306: Parte306 | null;
}

/** `DESC NULLS LAST` para texto. */
function descNulosUltimo(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/** `DESC` padrão do Postgres (nulos primeiro). */
function descNulosPrimeiro(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? 1 : -1;
}

/** Horário de SP sem fuso → instante. atalho: −3 h fixo (sem horário de verão desde 2019). */
function instanteSp(dia: string, hora: string | null): Date {
  const hhmm = /^\d{1,2}:\d{2}/.test(hora ?? "")
    ? (hora ?? "").padStart(5, "0").slice(0, 5)
    : "12:00";
  return new Date(`${dia}T${hhmm}:00-03:00`);
}

/**
 * Última linha do 036 do CT-e (inclui canceladas e romaneio nulo). Ordem: importação, romaneio
 * (nulo primeiro), BAIXADO primeiro, data/hora da ocorrência, emissão.
 * origem: mv_romaneio_036_ctrc
 */
export function ultimo036(linhas: readonly Linha036[]): Parte036 | null {
  const l = [...linhas]
    .filter((x) => sswNum(x.ctrc) !== null)
    .sort(
      (a, b) =>
        maisNovaPrimeiro(a, b) ||
        descNulosPrimeiro(a.romaneio, b.romaneio) ||
        descNulosPrimeiro(
          a.situacao === null ? null : String(a.situacao === "BAIXADO"),
          b.situacao === null ? null : String(b.situacao === "BAIXADO"),
        ) ||
        descNulosUltimo(a.dataOcorrCtrc, b.dataOcorrCtrc) ||
        descNulosUltimo(a.horaOcorrCtrc, b.horaOcorrCtrc) ||
        descNulosUltimo(a.dataEmissao, b.dataEmissao),
    )[0];
  if (!l) return null;
  return {
    romaneio: l.romaneio,
    situacao: l.situacao,
    placa: normPlaca(l.placa),
    motorista: l.motorista,
    ajudante: l.ajudante,
    ajudante2: l.ajudante2,
    ajudante3: l.ajudante3,
    codOcorr: l.codOcorrCtrc,
    descOcorr: l.descOcorrCtrc,
    dataOcorr: l.dataOcorrCtrc ? instanteSp(l.dataOcorrCtrc, l.horaOcorrCtrc) : null,
    dataEmissao: l.dataEmissao,
  };
}

/** Número do CT-e no 306: só quando `ctrc_coleta` começa com 2–4 letras + dígito. */
export function numeroDo306(ctrcColeta: string | null): string | null {
  const t = (ctrcColeta ?? "").trim();
  return /^[A-Z]{2,4}[0-9]/.test(t) ? sswNum(t) : null;
}

/** Última linha do 306: data (nula por último), depois importação. origem: romaneio_ctrc_motorista_306 */
export function ultimo306(linhas: readonly Linha306[]): Parte306 | null {
  const l = [...linhas]
    .filter((x) => numeroDo306(x.ctrcColeta) !== null)
    .sort((a, b) => descNulosUltimo(a.data, b.data) || maisNovaPrimeiro(a, b))[0];
  return l ? { placa: normPlaca(l.placa), motorista: l.motorista, data: l.data } : null;
}

/**
 * Romaneio atual do CT-e. Parte sem linha guardada fica como estava.
 * origem: mv_romaneio_ctrc_motorista (FULL JOIN do 036 com o 306)
 */
export function romaneioAtualDoCte(
  l036: readonly Linha036[],
  l306: readonly Linha306[],
  gravado: RomaneioAtual | null,
): RomaneioAtual | null {
  const r036 = l036.length > 0 ? ultimo036(l036) : (gravado?.r036 ?? null);
  const r306 = l306.length > 0 ? ultimo306(l306) : (gravado?.r306 ?? null);
  if (r036 === null && r306 === null) return null;
  return {
    placa: r036?.placa ?? r306?.placa ?? null,
    motorista: r036?.motorista ?? r306?.motorista ?? null,
    r036,
    r306,
  };
}

// ---------------------------------------------------------------------------------------------
// 5.5 Dados dos relatórios 038/455

export interface Parte038 {
  setor: string | null;
  bairro: string | null;
  endereco: string | null;
  cep: string | null;
  valorMercadoria: number | null;
}

export interface DadosRelatorios {
  /** Valor da mercadoria: 038, senão 455. */
  valorMercadoria: number | null;
  r038: Parte038 | null;
  valorMercadoria455: number | null;
}

const textoOuNulo = (t: string | null) => t?.trim() || null;

/**
 * Setor, bairro, endereço e CEP do 038 mais recente; valor da mercadoria do 038, senão do 455.
 * origem: mv_ctrc_staging_enriquecido
 */
export function dadosRelatoriosDoCte(
  l038: readonly Linha038[],
  l455: readonly Linha455[],
  gravado: DadosRelatorios | null,
): DadosRelatorios | null {
  const s038 = [...l038].sort(maisNovaPrimeiro)[0];
  const s455 = [...l455].sort(maisNovaPrimeiro)[0];
  const r038: Parte038 | null = s038
    ? {
        setor: textoOuNulo(s038.setor),
        bairro: textoOuNulo(s038.bairro),
        endereco: textoOuNulo(s038.endereco),
        cep: textoOuNulo(s038.cep),
        valorMercadoria: s038.valorMercadoria,
      }
    : (gravado?.r038 ?? null);
  const valorMercadoria455 = s455 ? s455.valorMercadoria : (gravado?.valorMercadoria455 ?? null);
  if (r038 === null && !s455 && !gravado) return null;
  return {
    valorMercadoria: r038?.valorMercadoria ?? valorMercadoria455,
    r038,
    valorMercadoria455,
  };
}

// ---------------------------------------------------------------------------------------------
// Conferente e romaneio do CT-e (tela Ocorrências)

/** Chave de ordem da linha 036 que deu o conferente (campos da linha). */
export interface OrdemDoConferente {
  dataOcorrCtrc: string | null;
  horaOcorrCtrc: string | null;
  situacao: string | null;
  dataEmissao: string | null;
  importadoEm: Date;
}

export interface ConferenteDoCte {
  conferente: string | null;
  romaneio: string;
  /**
   * Chave da linha vencedora: a linha expira (60 dias) e a gravada concorre com as guardadas.
   * Nula no que foi gravado antes de a chave existir.
   */
  ordem: OrdemDoConferente | null;
}

const baixado = (o: OrdemDoConferente) =>
  o.situacao === null ? null : String(o.situacao === "BAIXADO");

function compararOrdem(a: OrdemDoConferente, b: OrdemDoConferente): number {
  return (
    descNulosUltimo(a.dataOcorrCtrc, b.dataOcorrCtrc) ||
    descNulosUltimo(a.horaOcorrCtrc, b.horaOcorrCtrc) ||
    descNulosPrimeiro(baixado(a), baixado(b)) ||
    descNulosUltimo(a.dataEmissao, b.dataEmissao) ||
    maisNovaPrimeiro(a, b)
  );
}

/**
 * Entre as linhas 036 com romaneio e situação diferente de CANCELADO, a primeira por data/hora da
 * ocorrência do CT-e (nulas por último), BAIXADO primeiro (situação nula antes), emissão e
 * importação. O sistema atual lê a staging inteira; aqui a linha vencedora pode ter expirado, então
 * o gravado (com a chave dele) concorre com as linhas guardadas e só perde para uma melhor; no
 * empate, a guardada vence. Sem linha válida guardada, fica o que estava gravado.
 * origem: _ocorrencias_conferente_romaneio (sistema atual)
 */
export function conferenteDoCte(
  linhas: readonly Linha036[],
  gravado: ConferenteDoCte | null,
): ConferenteDoCte | null {
  const candidatos: { conferente: string | null; romaneio: string; ordem: OrdemDoConferente }[] =
    [];
  for (const l of linhas) {
    if (l.romaneio === null || l.situacao === "CANCELADO" || sswNum(l.ctrc) === null) continue;
    candidatos.push({
      conferente: l.conferente?.trim() || null,
      romaneio: l.romaneio,
      ordem: {
        dataOcorrCtrc: l.dataOcorrCtrc,
        horaOcorrCtrc: l.horaOcorrCtrc,
        situacao: l.situacao,
        dataEmissao: l.dataEmissao,
        importadoEm: l.importadoEm,
      },
    });
  }
  if (gravado?.ordem) candidatos.push({ ...gravado, ordem: gravado.ordem });
  return candidatos.sort((a, b) => compararOrdem(a.ordem, b.ordem))[0] ?? gravado;
}

// ---------------------------------------------------------------------------------------------
// Caso de uso: recálculo incremental e reconstrução completa

/** Estado gravado das projeções de um conjunto de CT-e. */
export interface ProjecoesGravadas {
  viagens: ReadonlyMap<string, readonly ViagemProjetada[]>;
  saidas: ReadonlyMap<string, readonly string[]>;
  atuais: ReadonlyMap<string, RomaneioAtual>;
  dados: ReadonlyMap<string, DadosRelatorios>;
  conferentes: ReadonlyMap<string, ConferenteDoCte>;
}

/** Estado novo de um CT-e (substitui o gravado dele). */
export interface ProjecaoDoCte {
  chave: ChaveCte;
  viagens: ViagemProjetada[];
  saidas: string[];
  atual: RomaneioAtual | null;
  dados: DadosRelatorios | null;
  conferente: ConferenteDoCte | null;
}

/**
 * O que as linhas apagadas de um CT-e (descarte de ciclo) podem ter trazido para as projeções:
 * os relatórios delas e, do 036, os romaneios e os dias de saída.
 */
export interface LinhasDescartadas extends ChaveCte {
  relatorios: readonly string[];
  romaneios: readonly string[];
  dias: readonly string[];
}

/** Estado gravado de um CT-e (o que o recálculo compara e usa como base). */
interface EstadoDoCte {
  viagens: readonly ViagemProjetada[];
  saidas: readonly string[];
  atual: RomaneioAtual | null;
  dados: DadosRelatorios | null;
  conferente: ConferenteDoCte | null;
}

/**
 * Tira do estado gravado tudo o que pode ter vindo das linhas descartadas; o recálculo devolve o
 * que as linhas que ficaram ainda sustentam (o gatilho de `romaneio_saida_ctrc` e o refresh das
 * matviews faziam isso de hoje).
 */
function semODescartado(e: EstadoDoCte, d: LinhasDescartadas): EstadoDoCte {
  const veio = (relatorio: string) => d.relatorios.includes(relatorio);
  const atual: RomaneioAtual | null = e.atual && {
    ...e.atual,
    r036: veio("036") ? null : e.atual.r036,
    r306: veio("306") ? null : e.atual.r306,
  };
  const dados: DadosRelatorios | null = e.dados && {
    ...e.dados,
    r038: veio("038") ? null : e.dados.r038,
    valorMercadoria455: veio("455csv") ? null : e.dados.valorMercadoria455,
  };
  return {
    viagens: e.viagens.filter((v) => !d.romaneios.includes(v.romaneio)),
    saidas: e.saidas.filter((dia) => !d.dias.includes(dia)),
    atual: atual?.r036 || atual?.r306 ? atual : null,
    dados: dados?.r038 || dados?.valorMercadoria455 != null ? dados : null,
    conferente: veio("036") ? null : e.conferente,
  };
}

export interface RepositorioProjecoesRomaneio {
  /** Linhas 036/306/038/455 guardadas dos CT-e, por `chaveDoCte` (lotes parciais fora). */
  linhasDosCtes(chaves: readonly ChaveCte[]): Promise<ReadonlyMap<string, LinhasDoCte>>;
  gravadas(chaves: readonly ChaveCte[]): Promise<ProjecoesGravadas>;
  /** Regrava as projeções dos CT-e dados (só os que mudaram). */
  gravar(projecoes: readonly ProjecaoDoCte[]): Promise<void>;
  /** CT-e com alguma linha 036/306/038/455 guardada, em ordem de chave, depois de `apos`. */
  chavesComLinhas(apos: ChaveCte | null, limite: number): Promise<ChaveCte[]>;
}

export interface ResumoDoRecalculo {
  ctes: number;
  alterados: number;
}

/** Forma canônica para comparar (ordem das chaves não importa; datas pelo instante). */
function canonico(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, canonico(x)]),
    );
  }
  return v;
}

const igual = (a: unknown, b: unknown) =>
  JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));

/**
 * Recalcula as projeções dos CT-e (incremental: chamado pela ingestão com as chaves das linhas
 * que acabou de gravar ou de apagar — `descartadas`). Roda na transação de quem chama.
 */
export async function recalcularProjecoesDoRomaneio(
  repo: RepositorioProjecoesRomaneio,
  chaves: readonly ChaveCte[],
  descartadas: readonly LinhasDescartadas[] = [],
): Promise<ResumoDoRecalculo> {
  const unicas = [
    ...new Map([...chaves, ...descartadas].map((c) => [chaveDoCte(c), c])).values(),
  ].map(({ sigla, numero }) => ({ sigla, numero }));
  if (unicas.length === 0) return { ctes: 0, alterados: 0 };
  const descarte = new Map(descartadas.map((d) => [chaveDoCte(d), d]));
  const linhas = await repo.linhasDosCtes(unicas);
  const gravadas = await repo.gravadas(unicas);
  const alteradas: ProjecaoDoCte[] = [];
  for (const chave of unicas) {
    const k = chaveDoCte(chave);
    const l = linhas.get(k) ?? { l036: [], l306: [], l038: [], l455: [] };
    const antes: EstadoDoCte = {
      viagens: gravadas.viagens.get(k) ?? [],
      saidas: gravadas.saidas.get(k) ?? [],
      atual: gravadas.atuais.get(k) ?? null,
      dados: gravadas.dados.get(k) ?? null,
      conferente: gravadas.conferentes.get(k) ?? null,
    };
    const d = descarte.get(k);
    const base = d ? semODescartado(antes, d) : antes;
    const depois = {
      viagens: viagensDoCte(l.l036, base.viagens),
      saidas: saidasDoCte(l.l036, base.saidas),
      atual: romaneioAtualDoCte(l.l036, l.l306, base.atual),
      dados: dadosRelatoriosDoCte(l.l038, l.l455, base.dados),
      conferente: conferenteDoCte(l.l036, base.conferente),
    };
    if (!igual(antes, depois)) alteradas.push({ chave, ...depois });
  }
  if (alteradas.length > 0) await repo.gravar(alteradas);
  return { ctes: unicas.length, alterados: alteradas.length };
}

/** Uma transação por lote: quem chama decide como abrir (worker: `executar`). */
export type ExecutarLote = <T>(
  fn: (repo: RepositorioProjecoesRomaneio) => Promise<T>,
) => Promise<T>;

/**
 * Reconstrução completa (conciliação): percorre todos os CT-e com linha guardada, em lotes.
 * `alterados > 0` é divergência do incremental (algo deixou de recalcular) e vai para o log.
 */
export async function reconstruirProjecoesDoRomaneio(
  executarLote: ExecutarLote,
  tamanhoDoLote = 500,
): Promise<ResumoDoRecalculo> {
  const total: ResumoDoRecalculo = { ctes: 0, alterados: 0 };
  let apos: ChaveCte | null = null;
  for (;;) {
    const depois = apos;
    const r = await executarLote(async (repo) => {
      const chaves = await repo.chavesComLinhas(depois, tamanhoDoLote);
      const resumo = await recalcularProjecoesDoRomaneio(repo, chaves);
      return { chaves, resumo };
    });
    total.ctes += r.resumo.ctes;
    total.alterados += r.resumo.alterados;
    const ultima = r.chaves.at(-1);
    if (r.chaves.length < tamanhoDoLote || !ultima) return total;
    apos = ultima;
  }
}
