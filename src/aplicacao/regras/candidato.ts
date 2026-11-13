/**
 * Candidato de um CT-e a partir das linhas guardadas do 930, do 038 e do 455 CSV, e o que ele muda
 * no CT-e (inserção, atualização, marcas de `campos_ssw`, ocorrências novas). Spec 06 §3.11.2.
 *
 * Diferenças do sistema atual (decisões do dono):
 * - o CT-e é casado por sigla + número (Q02): não há "série vigente" nem CT-e "estacionado";
 * - entrega só com a data (930 sem hora) vira meia-noite de Brasília (Q11/D7), não 00:00 UTC;
 * - previsão do SSW em CT-e com prazo de regra vai para `previsao_ssw_*` (Q19).
 */
import { CODIGOS_ENTREGA, diaSp, ehFonteDeRegra, inicioDoDiaSp } from "@erp/domain/core";

import {
  codigoOcorrencia,
  numero455,
  type Registro038,
  type Registro455Csv,
  type Registro930,
  texto455,
  unidadeDeLocalizacao,
} from "../../fontes/relatorios";
import {
  aparado,
  type CamposDoCte,
  type ChaveCte,
  type CteDaIngestao,
  digitosOuNulo,
  ingenuoSp,
  instanteSp,
  type LinhaGuardada,
  maisNovaPrimeiro,
  maiusculoAparado,
  maximo,
  minimo,
  numericIgual,
  paraNumeric,
} from "./comum";
import { CODIGO_ESTORNO } from "./estorno";

const CODIGO_EMISSAO = 80;
const CODIGO_AGENDAMENTO = 15;
const MAIOR_INTEIRO_PG = 2_147_483_647;

// --- 930 -------------------------------------------------------------------------------------

/** "...ENTREGA AGENDADA P/ 15/11/26..." → "2026-11-15"; data inexistente = `null`. */
export function dataEntregaAgendada(complemento: string | null): string | null {
  const m = /AGENDADA P\/ (\d{2})\/(\d{2})\/(\d{2})/.exec(complemento ?? "");
  if (!m) return null;
  const [, d = "", mes = "", a = ""] = m;
  const iso = `20${a}-${mes}-${d}`;
  const data = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(data.getTime()) && data.toISOString().startsWith(iso) ? iso : null;
}

export interface Agregado930 {
  emissaoCtrc: string | null;
  ev80Data: string | null;
  /** Hora ingênua de São Paulo. */
  entregaEm: string | null;
  dataEntrega: string | null;
  temAnulada: boolean;
  nroCte: string | null;
  serieCte: string | null;
  nroNotaFiscal: string | null;
  serieNotaFiscal: string | null;
  cnpjPagador: string | null;
  nomePagador: string | null;
  primeiroManifesto: string | null;
  agendadaPara: string | null;
  /** Hora ingênua de São Paulo. */
  agendadaEm: string | null;
}

/** origem: aplicar_staging_ssw, CTE `c` (sistema atual) */
export function agregar930(
  linhas: readonly LinhaGuardada<Registro930>[],
  anuladas: ReadonlySet<number>,
): Agregado930 | null {
  if (linhas.length === 0) return null;
  const d = linhas.map((l) => ({
    ...l.dados,
    cod: codigoOcorrencia(l.dados.cod_ocor),
    ok: !anuladas.has(l.id),
  }));
  const agendas = d
    .filter((r) => r.cod === CODIGO_AGENDAMENTO)
    .map((r) => ({
      para: dataEntregaAgendada(r.complemento_ocor),
      em: r.inclusao_em ?? r.ocorrencia_em,
      oc: r.ocorrencia_em,
    }))
    .filter((r) => r.para !== null)
    .sort((a, b) => cmpDesc(a.em, b.em) || cmpDesc(a.oc, b.oc));
  return {
    emissaoCtrc: maximo(d.map((r) => r.emissao_ctrc)),
    ev80Data:
      minimo(d.filter((r) => r.cod === CODIGO_EMISSAO).map((r) => r.ocorrencia_em))?.slice(0, 10) ??
      null,
    entregaEm: maximo(
      d.filter((r) => r.ok && CODIGOS_ENTREGA.has(r.cod ?? -1)).map((r) => r.ocorrencia_em),
    ),
    dataEntrega: maximo(
      d.filter((r) => r.ok && r.cod !== CODIGO_ESTORNO).map((r) => r.data_entrega),
    ),
    temAnulada: d.some((r) => !r.ok),
    nroCte: maximo(d.map((r) => r.nro_cte)),
    serieCte: maximo(d.map((r) => r.serie_cte)),
    nroNotaFiscal: maximo(d.map((r) => r.nro_nota_fiscal)),
    serieNotaFiscal: maximo(d.map((r) => r.serie_nota_fiscal)),
    cnpjPagador: maximo(d.map((r) => r.cnpj_pagador)),
    nomePagador: maximo(d.map((r) => r.nome_pagador)),
    primeiroManifesto: maximo(d.map((r) => r.primeiro_manifesto)),
    agendadaPara: agendas[0]?.para ?? null,
    agendadaEm: maximo(agendas.map((a) => a.em)),
  };
}

/** Ordem decrescente com nulos por último (`DESC NULLS LAST`). */
function cmpDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

// --- 455 CSV (no formato do 455 antigo) -------------------------------------------------------

/** "001989-TORCH" → "TORCH" (código do cliente na frente do nome). */
export function semCodigo(v: string | null): string | null {
  return aparado((v ?? "").trim().replace(/^[0-9]{3,}-/, ""));
}

/** Colunas do 455 que a aplicação usa, como o espelho `espelhar_455csv_no_455` gravava. */
export interface Linha455 {
  inclusao: Date | null;
  remetente: string | null;
  destinatario: string | null;
  cidade: string | null;
  uf: string | null;
  pagador: string | null;
  notaFiscal: string | null;
  pesoCalc: number | null;
  frete: number | null;
  valorMercadoria: number | null;
  cnpjPagador: string | null;
  tipoDocumento: string | null;
  previsaoEntrega: string | null;
}

/** origem: espelhar_455csv_no_455 (sistema atual) */
export function espelho455(r: Registro455Csv): Linha455 {
  const emissao = texto455(r, "data_de_emissao");
  const hora = texto455(r, "hora_de_emissao");
  const hhmm = hora !== null && /^[0-2][0-9]:[0-5][0-9]$/.test(hora) ? hora : "00:00";
  return {
    inclusao: emissao ? instanteSp(`${emissao}T${hhmm}`) : null,
    remetente: semCodigo(texto455(r, "cliente_remetente")),
    destinatario: semCodigo(texto455(r, "cliente_destinatario")),
    cidade: aparado(
      aparado(texto455(r, "cidade_de_entrega")) ?? texto455(r, "cidade_do_destinatario"),
    ),
    uf: aparado(aparado(texto455(r, "uf_de_entrega")) ?? texto455(r, "uf_do_destinatario")),
    pagador: semCodigo(texto455(r, "cliente_pagador")),
    notaFiscal: aparado(texto455(r, "numero_da_nota_fiscal")),
    pesoCalc: numero455(r, "peso_calculado_em_kg"),
    frete: numero455(r, "valor_do_frete"),
    valorMercadoria: numero455(r, "valor_da_mercadoria"),
    cnpjPagador: digitosOuNulo(texto455(r, "cnpj_pagador")),
    tipoDocumento: maiusculoAparado(texto455(r, "tipo_do_documento")),
    previsaoEntrega: texto455(r, "previsao_de_entrega"),
  };
}

export interface Agregado455 {
  escolhida: Linha455;
  inclusaoMin: Date | null;
  tipoDocumentoUlt: string | null;
  previsaoUlt: string | null;
  previsaoUltEm: Date | null;
}

/** origem: aplicar_staging_ssw, CTE `b` (sistema atual) */
export function agregar455(linhas: readonly LinhaGuardada<Registro455Csv>[]): Agregado455 | null {
  if (linhas.length === 0) return null;
  const todas = [...linhas].sort(maisNovaPrimeiro).map((l) => ({ ...l, e: espelho455(l.dados) }));
  // Uma linha por lote (a mais nova); entre elas, a de inclusão mais recente.
  const porLote = new Map<string, (typeof todas)[number]>();
  for (const l of todas) if (!porLote.has(l.loteId)) porLote.set(l.loteId, l);
  const [escolhida] = [...porLote.values()].sort(
    (a, b) =>
      (b.e.inclusao?.getTime() ?? -Infinity) - (a.e.inclusao?.getTime() ?? -Infinity) ||
      maisNovaPrimeiro(a, b),
  );
  if (!escolhida) return null;
  const comPrevisao = todas.filter((l) => l.e.previsaoEntrega !== null);
  const inclusoes = todas.flatMap((l) => (l.e.inclusao ? [l.e.inclusao.getTime()] : []));
  return {
    escolhida: escolhida.e,
    inclusaoMin: inclusoes.length ? new Date(Math.min(...inclusoes)) : null,
    tipoDocumentoUlt: todas.find((l) => l.e.tipoDocumento !== null)?.e.tipoDocumento ?? null,
    previsaoUlt: comPrevisao[0]?.e.previsaoEntrega ?? null,
    previsaoUltEm: comPrevisao[0]?.importadoEm ?? null,
  };
}

/** Linha do 038 de maior `importado_em` (a foto mais nova dos pendentes). */
export function ultimo038(
  linhas: readonly LinhaGuardada<Registro038>[],
): LinhaGuardada<Registro038> | null {
  return [...linhas].sort(maisNovaPrimeiro)[0] ?? null;
}

// --- Candidato -------------------------------------------------------------------------------

export interface Candidato extends ChaveCte {
  dataEmissao: string | null;
  numeroNf: number | null;
  serieNf: string | null;
  numeroCte: number | null;
  siglaCte: string | null;
  remetente: string | null;
  destinatario: string | null;
  cidadeDestino: string | null;
  ufDestino: string | null;
  bairroDestino: string | null;
  logradouroDestino: string | null;
  cepDestinatario: string | null;
  setor: string | null;
  peso: number | null;
  volumes: number | null;
  valorMercadoria: number | null;
  valorFrete: number | null;
  pagadorNome: string | null;
  pagadorCnpj: string | null;
  previsao: string | null;
  tipoDocumento455: string | null;
  atrasoDias: number | null;
  primeiroManifesto: string | null;
  dataEntregaRealizada: Date | null;
  localizacaoAtual: string | null;
  unidadeAtual: string | null;
}

function inteiroDosDigitos(v: string | null): number | null {
  const d = digitosOuNulo(v);
  if (d === null) return null;
  const n = Number(d);
  return Number.isSafeInteger(n) && n <= MAIOR_INTEIRO_PG ? n : null;
}

const zeroParaNulo = (n: number | null) => (n === 0 ? null : n);

/** origem: aplicar_staging_ssw, `montar candidato` (sistema atual) */
export function montarCandidato(entrada: {
  chave: ChaveCte;
  c: Agregado930 | null;
  b: Agregado455 | null;
  a: LinhaGuardada<Registro038> | null;
  /** CT-e já gravado (o agendamento só vale para CT-e em aberto). */
  prod: Pick<CteDaIngestao, "dataEntregaRealizada"> | null;
  dominioSsw: string | null;
}): Candidato {
  const { chave, c, b, a, prod } = entrada;
  const a038 = a?.dados ?? null;
  const e = b?.escolhida ?? null;
  const agendaVale =
    c?.agendadaPara != null &&
    c.agendadaEm != null &&
    (prod === null || prod.dataEntregaRealizada === null) &&
    (c.emissaoCtrc === null || c.agendadaPara >= c.emissaoCtrc) &&
    (a === null || c.agendadaEm > ingenuoSp(a.importadoEm)) &&
    (b?.previsaoUltEm == null || c.agendadaEm > ingenuoSp(b.previsaoUltEm));
  const previsao455Vence =
    b?.previsaoUlt != null &&
    (a === null ||
      a038?.prazo_entrega == null ||
      (b.previsaoUltEm !== null && b.previsaoUltEm > a.importadoEm));
  const previsao = agendaVale
    ? c.agendadaPara
    : previsao455Vence
      ? b.previsaoUlt
      : (a038?.prazo_entrega ?? b?.previsaoUlt ?? null);
  const inclusao = b?.inclusaoMin ?? e?.inclusao ?? null;
  const localizacao = aparado(a038?.localizacao);
  return {
    ...chave,
    dataEmissao: c?.emissaoCtrc ?? c?.ev80Data ?? (inclusao ? diaSp(inclusao) : null),
    numeroNf: inteiroDosDigitos(c?.nroNotaFiscal ?? e?.notaFiscal ?? a038?.nota_fiscal ?? null),
    serieNf: aparado(c?.serieNotaFiscal),
    numeroCte: zeroParaNulo(inteiroDosDigitos(c?.nroCte ?? null)),
    siglaCte: aparado(c?.serieCte),
    remetente: aparado(a038?.remetente ?? e?.remetente),
    destinatario: aparado(a038?.destinatario ?? e?.destinatario),
    cidadeDestino: aparado(a038?.cidade ?? e?.cidade),
    ufDestino: aparado(e?.uf),
    bairroDestino: aparado(a038?.bairro),
    logradouroDestino: aparado(a038?.endereco),
    cepDestinatario: aparado(a038?.cep),
    setor: aparado(a038?.setor),
    peso: a038?.peso ?? e?.pesoCalc ?? null,
    volumes: a038?.quantidade_volumes ?? null,
    valorMercadoria: e?.valorMercadoria ?? a038?.valor_mercadoria ?? null,
    valorFrete: e?.frete ?? null,
    pagadorNome: aparado(c?.nomePagador ?? e?.pagador),
    pagadorCnpj: digitosOuNulo(aparado(c?.cnpjPagador) ?? e?.cnpjPagador),
    previsao,
    tipoDocumento455: b?.tipoDocumentoUlt ?? null,
    atrasoDias: a038?.atraso ?? null,
    primeiroManifesto: aparado(c?.primeiroManifesto),
    dataEntregaRealizada: c?.entregaEm
      ? instanteSp(c.entregaEm)
      : c?.dataEntrega
        ? inicioDoDiaSp(c.dataEntrega)
        : null,
    localizacaoAtual: localizacao,
    unidadeAtual:
      localizacao === null ? null : unidadeDeLocalizacao(localizacao, entrada.dominioSsw),
  };
}

// --- Gravação --------------------------------------------------------------------------------

const vazio = (v: string | null) => v === null || v.trim() === "";

/**
 * Campos de um CT-e novo (6a): filial = sigla; prazo e performance marcados como vindos do SSW.
 * Sem emissão não há CT-e (`null`: ignorado como `sem_data_emissao`).
 */
export function camposDoCteNovo(c: Candidato): CamposDoCte | null {
  if (c.dataEmissao === null) return null;
  return {
    sigla: c.sigla,
    numero: c.numero,
    filial: c.sigla,
    dataEmissao: c.dataEmissao,
    numeroNf: c.numeroNf,
    serieNf: c.serieNf,
    numeroCte: c.numeroCte,
    siglaCte: c.siglaCte,
    remetente: c.remetente,
    destinatario: c.destinatario,
    cidadeDestino: c.cidadeDestino,
    ufDestino: c.ufDestino,
    bairroDestino: c.bairroDestino,
    logradouroDestino: c.logradouroDestino,
    cepDestinatario: c.cepDestinatario,
    setor: c.setor,
    peso: paraNumeric(c.peso, 3),
    volumes: c.volumes,
    valorMercadoria: paraNumeric(c.valorMercadoria, 2),
    valorFrete: paraNumeric(c.valorFrete, 2),
    pagadorNome: c.pagadorNome,
    pagadorCnpj: c.pagadorCnpj,
    dataPrevistaEntrega: c.previsao,
    prazoEntrega: c.previsao,
    prazoOrigem: "proprio",
    prazoFonte: "ssw_manual",
    fontePerformance: "ssw_manual",
    tipoDocumento455: c.tipoDocumento455,
    atrasoDias: c.atrasoDias,
    primeiroManifesto: c.primeiroManifesto,
    dataEntregaRealizada: c.dataEntregaRealizada,
    localizacaoAtual: c.localizacaoAtual,
    unidadeAtual: c.unidadeAtual,
  };
}

/**
 * O que muda num CT-e existente (6b). Previsão: em aberto o SSW sobrescreve, entregue só preenche
 * vazio; com prazo de regra configurada, a previsão do SSW vai para `previsao_ssw_*` (Q19).
 */
export function diferencasDoCte(p: CteDaIngestao, c: Candidato): CamposDoCte {
  const d: CamposDoCte = {};
  if (c.dataEmissao !== null && c.dataEmissao !== p.dataEmissao) d.dataEmissao = c.dataEmissao;
  if (p.numeroNf === null && c.numeroNf !== null) d.numeroNf = c.numeroNf;
  if (p.numeroCte === null && c.numeroCte !== null) d.numeroCte = c.numeroCte;
  if (p.peso === null && c.peso !== null) d.peso = paraNumeric(c.peso, 3);
  if (p.volumes === null && c.volumes !== null) d.volumes = c.volumes;
  if (p.valorMercadoria === null && c.valorMercadoria !== null) {
    d.valorMercadoria = paraNumeric(c.valorMercadoria, 2);
  }
  if (p.valorFrete === null && c.valorFrete !== null) d.valorFrete = paraNumeric(c.valorFrete, 2);
  if (p.dataEntregaRealizada === null && c.dataEntregaRealizada !== null) {
    d.dataEntregaRealizada = c.dataEntregaRealizada;
  }
  const textos = [
    "serieNf",
    "siglaCte",
    "remetente",
    "destinatario",
    "cidadeDestino",
    "ufDestino",
    "bairroDestino",
    "logradouroDestino",
    "cepDestinatario",
    "setor",
    "pagadorNome",
    "pagadorCnpj",
    "primeiroManifesto",
    "localizacaoAtual",
    "unidadeAtual",
  ] as const;
  for (const campo of textos) {
    const novo = c[campo];
    if (vazio(p[campo]) && novo !== null) d[campo] = novo;
  }
  const emAberto = p.dataEntregaRealizada === null;
  if (c.previsao !== null) {
    const regra = ehFonteDeRegra(p.prazoFonte);
    const atual = regra ? p.previsaoSswData : p.dataPrevistaEntrega;
    if (atual === null || (emAberto && atual !== c.previsao)) {
      if (regra) {
        d.previsaoSswData = c.previsao;
        d.previsaoSswFonte = "ssw_manual";
      } else {
        d.dataPrevistaEntrega = c.previsao;
        d.prazoFonte = "ssw_manual";
      }
    }
    if (p.prazoEntrega === null || (emAberto && p.prazoEntrega !== c.previsao)) {
      d.prazoEntrega = c.previsao;
    }
  }
  if (c.atrasoDias !== null && c.atrasoDias !== p.atrasoDias) d.atrasoDias = c.atrasoDias;
  if (c.tipoDocumento455 !== null && c.tipoDocumento455 !== p.tipoDocumento455) {
    d.tipoDocumento455 = c.tipoDocumento455;
  }
  return d;
}

/**
 * Colunas cujo valor gravado é igual ao do candidato: entram em `campos_ssw` (o BI2 não as
 * sobrescreve). União ordenada, sem repetição.
 * origem: aplicar_staging_ssw, passo 6c (sistema atual)
 */
export function camposSswDoCte(gravado: CteDaIngestao, c: Candidato): string[] {
  const igualTexto = (a: string | null, b: string | null) =>
    a !== null && b !== null && a.trim() === b.trim();
  const iguais: [string, boolean][] = [
    ["sigla", igualTexto(gravado.sigla, c.sigla)],
    ["data_emissao", c.dataEmissao !== null && gravado.dataEmissao === c.dataEmissao],
    ["numero_nf", c.numeroNf !== null && gravado.numeroNf === c.numeroNf],
    ["serie_nf", igualTexto(gravado.serieNf, c.serieNf)],
    ["numero_cte", c.numeroCte !== null && gravado.numeroCte === c.numeroCte],
    ["sigla_cte", igualTexto(gravado.siglaCte, c.siglaCte)],
    ["remetente", igualTexto(gravado.remetente, c.remetente)],
    ["destinatario", igualTexto(gravado.destinatario, c.destinatario)],
    ["cidade_destino", igualTexto(gravado.cidadeDestino, c.cidadeDestino)],
    ["uf_destino", igualTexto(gravado.ufDestino, c.ufDestino)],
    ["bairro_destino", igualTexto(gravado.bairroDestino, c.bairroDestino)],
    ["logradouro_destino", igualTexto(gravado.logradouroDestino, c.logradouroDestino)],
    ["cep_destinatario", igualTexto(gravado.cepDestinatario, c.cepDestinatario)],
    ["setor", igualTexto(gravado.setor, c.setor)],
    ["peso", c.peso !== null && numericIgual(gravado.peso, c.peso, 3)],
    ["volumes", c.volumes !== null && gravado.volumes === c.volumes],
    [
      "valor_mercadoria",
      c.valorMercadoria !== null && numericIgual(gravado.valorMercadoria, c.valorMercadoria, 2),
    ],
    ["valor_frete", c.valorFrete !== null && numericIgual(gravado.valorFrete, c.valorFrete, 2)],
    ["pagador_nome", igualTexto(gravado.pagadorNome, c.pagadorNome)],
    ["pagador_cnpj", igualTexto(gravado.pagadorCnpj, c.pagadorCnpj)],
    ["data_prevista_entrega", c.previsao !== null && gravado.dataPrevistaEntrega === c.previsao],
    ["prazo_entrega", c.previsao !== null && gravado.prazoEntrega === c.previsao],
    ["atraso_dias", c.atrasoDias !== null && gravado.atrasoDias === c.atrasoDias],
    ["primeiro_manifesto", igualTexto(gravado.primeiroManifesto, c.primeiroManifesto)],
    [
      "data_entrega_realizada",
      c.dataEntregaRealizada !== null &&
        gravado.dataEntregaRealizada?.getTime() === c.dataEntregaRealizada.getTime(),
    ],
    ["localizacao_atual", igualTexto(gravado.localizacaoAtual, c.localizacaoAtual)],
    ["unidade_atual", igualTexto(gravado.unidadeAtual, c.unidadeAtual)],
  ];
  return uniaoOrdenada(
    gravado.camposSsw,
    iguais.filter(([, igual]) => igual).map(([col]) => col),
  );
}

export function uniaoOrdenada(atuais: readonly string[], novas: readonly string[]): string[] {
  return [...new Set([...atuais, ...novas])].sort();
}

// --- Ocorrências do 930 ----------------------------------------------------------------------

export interface OcorrenciaDo930 {
  codigo: number;
  dataHora: Date;
  descricao: string | null;
  complemento: string | null;
  filial: string | null;
}

/**
 * Ocorrências que o 930 traz para o CT-e: linhas com hora, não anuladas, código 0–99 e da mesma
 * emissão do CT-e (930 de outra emissão não liga). Uma por (código, instante): a primeira fica.
 * origem: aplicar_staging_ssw, passo 7 (sistema atual)
 */
export function ocorrenciasDo930(
  linhas: readonly LinhaGuardada<Registro930>[],
  anuladas: ReadonlySet<number>,
  emissaoDoCte: string,
): OcorrenciaDo930[] {
  const saida = new Map<string, OcorrenciaDo930>();
  for (const l of linhas) {
    const codigo = codigoOcorrencia(l.dados.cod_ocor);
    const em = l.dados.ocorrencia_em;
    if (anuladas.has(l.id) || em === null || codigo === null || codigo > 99) continue;
    if (l.dados.emissao_ctrc !== emissaoDoCte) continue;
    const dataHora = instanteSp(em);
    const chave = `${codigo}|${dataHora.getTime()}`;
    if (!saida.has(chave)) {
      saida.set(chave, {
        codigo,
        dataHora,
        descricao: aparado(l.dados.descricao_ocor),
        complemento: aparado(l.dados.complemento_ocor),
        filial: aparado(l.dados.unid_ocor),
      });
    }
  }
  return [...saida.values()];
}
