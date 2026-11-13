/**
 * Situação de cada CT-e no Romaneio (cards do topo, recortes da lista, KPIs, distribuição de
 * códigos, motivos de não entrega). Spec: docs/regras/03-romaneio-prazo-parceiro.md §3.
 *
 * O repositório entrega os "fatos" de cada CT-e (colunas gravadas + as ocorrências que contam); a
 * regra é toda daqui. Decisões do dono aplicadas: Q11 (dia de Brasília), Q13 (lista segue o card),
 * Q14 (prejuízo na janela do período em todas as abas), Q15 (prejuízo só de quem saiu), Q22
 * (baixa pelo cadastro da empresa).
 */
import { type CampoData, type Recorte } from "@erp/shared/contracts/manifest";

import {
  diaSp,
  ehTipoPendencia,
  estaEntregue,
  estaFinalizadoSemEntrega,
  inicioDoDiaSp,
  normCodigoOcorr,
} from "../core";
import { centavos, reais } from "../performance/numbers";
import { CODIGO_RETORNO, CODIGO_SAIDA, CODIGOS_ROTA } from "./normalization";

export interface Periodo {
  inicio: string;
  fim: string;
}

export interface OcorrenciaDoCte {
  codigo: number;
  dataHora: Date;
  quarentena: boolean;
  criadoEm: Date;
}

export interface CodigoCadastrado {
  codigo: number;
  descricao: string;
  tipoSsw: string | null;
  penaliza: boolean;
  responsavel: string;
}

/** Catálogo de códigos da empresa. */
export interface Cadastro {
  codigo(codigo: number): CodigoCadastrado | undefined;
  /** Códigos com tipo BAIXA (Q22: cadastro da própria empresa). */
  baixa: ReadonlySet<number>;
}

export function criarCadastro(codigos: readonly CodigoCadastrado[]): Cadastro {
  const porCodigo = new Map(codigos.map((c) => [c.codigo, c]));
  return {
    codigo: (codigo) => porCodigo.get(codigo),
    baixa: new Set(codigos.filter((c) => c.tipoSsw === "BAIXA").map((c) => c.codigo)),
  };
}

/** O que o Romaneio lê de cada CT-e. */
export interface FatoCte {
  id: string;
  sigla: string;
  numero: string;
  dataEmissao: string;
  dataPrevista: string | null;
  dataEntregaRealizada: Date | null;
  criadoEm: Date;
  ocorrEfetivaCodigo: string | null;
  codigo0013: string | null;
  codigo0174: string | null;
  valorFrete: number;
  peso: number;
  volumes: number;
  tde: number | null;
  cidadeDestino: string | null;
  pagadorNome: string | null;
  /** Ocorrências do CT-e (todas, ou ao menos as dos códigos que a regra consulta). */
  ocorrencias: readonly OcorrenciaDoCte[];
}

/** Regras do período: catálogo, códigos de prejuízo e janela. */
export interface ContextoDaRegra {
  cadastro: Cadastro;
  codigosPrejuizo: readonly number[];
  periodo: Periodo;
  campo: CampoData;
}

export type SaiuStatus = "sim" | "quarentena" | "nao_rastreado";

export interface AnaliseCte {
  entregue: boolean;
  /** Baixa formal sem entrega. */
  finalizado: boolean;
  /** Em rota pela regra do card (efetiva 85 válida; sem efetiva, 0013/0174; sem nada, a 85). */
  emRota: boolean;
  /** Pendência depois da última saída, sem estar em rota. */
  travado: boolean;
  /** Saiu para entrega pela regra do card (inclui travado e baixado). */
  saiuCard: boolean;
  /** Saiu para entrega pelos códigos de rua (`_saiu_entrega_status`). */
  saiuEntrega: SaiuStatus;
  /** "Em rota agora" da lista: última ocorrência é a 85. */
  emRotaAgora: boolean;
  teveProblema: boolean;
  /** Ocorrência penalizante da FR no período e o CT-e saiu para entrega (Q14, Q15). */
  prejudicado: boolean;
  ultimaPendencia: Date | null;
  ultimaLiberacao: Date | null;
  ultimaOcorrencia: Date | null;
}

const ehPendencia = (cadastro: Cadastro, codigo: number) =>
  codigo !== CODIGO_SAIDA && ehTipoPendencia(cadastro.codigo(codigo)?.tipoSsw ?? null);

/**
 * Penalizante da FR pelo CADASTRO do código (não a coluna da ocorrência), fora a 85, entre os
 * códigos de prejuízo. A quarentena não é olhada.
 */
export function ehPenalizanteFR(cadastro: Cadastro, codigo: number): boolean {
  const cad = cadastro.codigo(codigo);
  return codigo !== CODIGO_SAIDA && cad?.penaliza === true && cad.responsavel === "FR";
}

function maisRecente(datas: Iterable<Date>): Date | null {
  let maior: Date | null = null;
  for (const d of datas) if (maior === null || d > maior) maior = d;
  return maior;
}

const noPeriodo = (dia: string, p: Periodo) => dia >= p.inicio && dia <= p.fim;

/** Ocorrência penalizante (códigos de prejuízo) com o dia (SP) dentro do período. */
export function ocorrenciasPenalizantes(
  c: FatoCte,
  ctx: Pick<ContextoDaRegra, "cadastro" | "codigosPrejuizo" | "periodo">,
): OcorrenciaDoCte[] {
  return c.ocorrencias.filter(
    (o) =>
      ctx.codigosPrejuizo.includes(o.codigo) &&
      ehPenalizanteFR(ctx.cadastro, o.codigo) &&
      noPeriodo(diaSp(o.dataHora), ctx.periodo),
  );
}

/**
 * "Saiu para entrega" pelos códigos de rua. origem: _saiu_entrega_status
 */
export function saiuParaEntrega(c: FatoCte): SaiuStatus {
  if (estaEntregue(c.dataEntregaRealizada, c.ocorrEfetivaCodigo)) return "sim";
  for (const col of [c.ocorrEfetivaCodigo, c.codigo0013, c.codigo0174]) {
    const n = normCodigoOcorr(col);
    if (n !== null && CODIGOS_ROTA.includes(n)) return "sim";
  }
  const deRota = c.ocorrencias.filter((o) => CODIGOS_ROTA.includes(o.codigo));
  if (deRota.length === 0) return "nao_rastreado";
  return deRota.some((o) => !o.quarentena) ? "sim" : "quarentena";
}

/** Retorno (13) por qualquer fonte, fora de quarentena. origem: romaneio_performance_* */
export function teveRetorno(c: FatoCte): boolean {
  const cods = [c.ocorrEfetivaCodigo, c.codigo0013, c.codigo0174].map(normCodigoOcorr);
  return (
    cods.includes(CODIGO_RETORNO) ||
    c.ocorrencias.some((o) => o.codigo === CODIGO_RETORNO && !o.quarentena)
  );
}

/**
 * Tudo o que as telas do Romaneio perguntam sobre um CT-e.
 * origem: get_romaneio_base_totais, get_romaneio_v3, _saiu_entrega_status (sistema atual)
 */
export function analisarCte(c: FatoCte, ctx: ContextoDaRegra): AnaliseCte {
  const { cadastro } = ctx;
  const de85 = c.ocorrencias.filter((o) => o.codigo === CODIGO_SAIDA);
  const corte = inicioDoDiaSp(c.dataEmissao);
  // 85 válida: fora de quarentena, a partir do dia da emissão e gravada depois do CT-e.
  const ok85 =
    de85.length === 0
      ? null
      : de85.some((o) => !o.quarentena && o.dataHora >= corte && o.criadoEm >= c.criadoEm);
  const pendencias = c.ocorrencias.filter((o) => ehPendencia(cadastro, o.codigo));
  const ultimaPendencia = maisRecente(pendencias.map((o) => o.dataHora));
  const ultimaLiberacao = maisRecente(de85.map((o) => o.dataHora));

  const entregue = estaEntregue(c.dataEntregaRealizada, c.ocorrEfetivaCodigo);
  const finalizado = estaFinalizadoSemEntrega(
    c.dataEntregaRealizada,
    c.ocorrEfetivaCodigo,
    cadastro.baixa,
  );
  const efetiva = normCodigoOcorr(c.ocorrEfetivaCodigo);
  const do0013 = normCodigoOcorr(c.codigo0013);
  const do0174 = normCodigoOcorr(c.codigo0174);
  const emRota =
    efetiva !== null
      ? efetiva === CODIGO_SAIDA && (ok85 ?? true)
      : do0013 !== null || do0174 !== null
        ? do0013 === CODIGO_SAIDA || do0174 === CODIGO_SAIDA
        : ok85 === true;
  const travado =
    !emRota &&
    ultimaPendencia !== null &&
    (ultimaLiberacao === null || ultimaPendencia >= ultimaLiberacao);
  const saiuEntrega = saiuParaEntrega(c);

  return {
    entregue,
    finalizado,
    emRota,
    travado,
    saiuCard: ctx.campo === "saida" || emRota || travado || finalizado,
    saiuEntrega,
    emRotaAgora: romaneadoStatus(c, ok85) === "sim",
    teveProblema: pendencias.length > 0,
    prejudicado: saiuEntrega === "sim" && ocorrenciasPenalizantes(c, ctx).length > 0,
    ultimaPendencia,
    ultimaLiberacao,
    ultimaOcorrencia: maisRecente(c.ocorrencias.map((o) => o.dataHora)),
  };
}

/**
 * "Em rota agora" da lista: alguma fonte com 85; senão, sem código nenhum, pela 85 da tabela.
 * origem: get_romaneio_v3 (romaneado_status)
 */
function romaneadoStatus(c: FatoCte, ok85: boolean | null): "sim" | "quarentena" | "nao" {
  const fontes = [c.ocorrEfetivaCodigo, c.codigo0013, c.codigo0174];
  if (fontes.some((f) => normCodigoOcorr(f) === CODIGO_SAIDA)) return "sim";
  if (fontes.some((f) => f !== null)) return "nao";
  if (ok85 === null) return "nao";
  return ok85 ? "sim" : "quarentena";
}

/**
 * "Sem movimento": aberto e sem ocorrência (ou emissão) há mais de `dias` dias.
 * origem: get_romaneio_base_totais (p_sem_movimento)
 */
export function estaSemMovimento(c: FatoCte, a: AnaliseCte, dias: number, agora: Date): boolean {
  if (a.entregue || a.finalizado) return false;
  const ultima = a.ultimaOcorrencia ?? inicioDoDiaSp(c.dataEmissao);
  return ultima.getTime() < agora.getTime() - dias * 86_400_000;
}

// ---------------------------------------------------------------------------------------------
// Recortes (card clicado / select "Situação")

/**
 * Recorte da lista com a MESMA regra do card (Q13): em rota/travado/baixado de §3.2.
 * origem: get_romaneio_v3 (p_recorte), corrigido para seguir get_romaneio_base_totais
 */
export function casaRecorte(c: FatoCte, a: AnaliseCte, recorte: Recorte, hoje: string): boolean {
  const { entregue: e, finalizado: f, emRota: r, travado: t } = a;
  const emRotaDeEntrega = !e && a.saiuCard;
  const prev = c.dataPrevista;
  switch (recorte) {
    case "todos":
      return true;
    case "entregues":
      return e;
    case "em_rota":
      return emRotaDeEntrega;
    case "em_rota_vencida":
      return emRotaDeEntrega && prev !== null && prev < hoje;
    case "em_rota_hoje":
      return emRotaDeEntrega && prev === hoje;
    case "em_rota_futuro":
      return emRotaDeEntrega && prev !== null && prev > hoje;
    case "em_rota_sem_prev":
      return emRotaDeEntrega && prev === null;
    case "devolvido":
      return !e && f;
    case "travado":
      return !e && !f && !r && t;
    case "parado":
      return !e && !f && !r && !t;
    case "romaneados":
      return e || f || r || t;
    case "tde_romaneado":
      return (c.tde ?? 0) > 0 && (e || (r && !f));
    case "otif":
      return a.teveProblema;
    case "prejuizo":
      return a.prejudicado;
  }
}

// ---------------------------------------------------------------------------------------------
// Cards do topo

export interface TotaisDoTopo {
  ctes: number;
  peso: number;
  volumes: number;
  frete: number;
  emRota: number;
  entregues: number;
  baixadoSemEntrega: number;
  travado: number;
  travadoMotivo: string | null;
  parado: number;
  otifProblemas: number;
  prejuizoCtes: number;
  prejuizoFrete: number;
  emRotaVencida: number;
  emRotaHoje: number;
  emRotaFuturo: number;
  emRotaSemPrev: number;
  tdeCtes: number;
  tdeRomaneado: number;
  tdeRomaneadoEmRota: number;
  tdeRomaneadoEntregue: number;
  tdeRomaneadoValor: number;
}

export interface CteAnalisado {
  fato: FatoCte;
  analise: AnaliseCte;
}

/**
 * Motivo mais frequente entre os travados: conta OCORRÊNCIAS de pendência desde a última saída,
 * pela descrição do cadastro. Empate: descrição em ordem alfabética.
 */
function motivoDosTravados(travados: readonly CteAnalisado[], cadastro: Cadastro): string | null {
  const contagem = new Map<string, number>();
  for (const { fato, analise } of travados) {
    for (const o of fato.ocorrencias) {
      if (!ehPendencia(cadastro, o.codigo)) continue;
      if (analise.ultimaLiberacao !== null && o.dataHora < analise.ultimaLiberacao) continue;
      const descricao = cadastro.codigo(o.codigo)?.descricao;
      if (descricao) contagem.set(descricao, (contagem.get(descricao) ?? 0) + 1);
    }
  }
  let melhor: [string, number] | null = null;
  for (const par of contagem) {
    if (!melhor || par[1] > melhor[1] || (par[1] === melhor[1] && par[0] < melhor[0])) melhor = par;
  }
  return melhor?.[0] ?? null;
}

/**
 * Cards do topo. `universo = "romaneados"` restringe os números de situação ao que saiu
 * (entregue, baixado, em rota ou travado); Prejuízo e TDE contam o período inteiro.
 * origem: get_romaneio_base_totais
 */
export function totaisDoTopo(
  ctes: readonly CteAnalisado[],
  universo: "todos" | "romaneados",
  cadastro: Cadastro,
  hoje: string,
): TotaisDoTopo {
  const t: TotaisDoTopo = {
    ctes: 0,
    peso: 0,
    volumes: 0,
    frete: 0,
    emRota: 0,
    entregues: 0,
    baixadoSemEntrega: 0,
    travado: 0,
    travadoMotivo: null,
    parado: 0,
    otifProblemas: 0,
    prejuizoCtes: 0,
    prejuizoFrete: 0,
    emRotaVencida: 0,
    emRotaHoje: 0,
    emRotaFuturo: 0,
    emRotaSemPrev: 0,
    tdeCtes: 0,
    tdeRomaneado: 0,
    tdeRomaneadoEmRota: 0,
    tdeRomaneadoEntregue: 0,
    tdeRomaneadoValor: 0,
  };
  const travados: CteAnalisado[] = [];
  // Dinheiro somado em centavos inteiros (o banco soma `numeric` sem erro de float).
  const centavosDe = { frete: 0, prejuizoFrete: 0, tdeRomaneadoValor: 0 };
  for (const item of ctes) {
    const { fato: c, analise: a } = item;
    if (a.prejudicado) {
      t.prejuizoCtes += 1;
      centavosDe.prejuizoFrete += centavos(c.valorFrete);
    }
    const tde = c.tde ?? 0;
    if (tde > 0) {
      t.tdeCtes += 1;
      const tdeEmRota = a.emRota && !a.entregue && !a.finalizado;
      if (tdeEmRota) t.tdeRomaneadoEmRota += 1;
      if (a.entregue) t.tdeRomaneadoEntregue += 1;
      if (a.entregue || (a.emRota && !a.finalizado)) centavosDe.tdeRomaneadoValor += centavos(tde);
    }
    const saiu = a.entregue || a.finalizado || a.emRota || a.travado;
    if (universo === "romaneados" && !saiu) continue;

    t.ctes += 1;
    t.peso += c.peso;
    t.volumes += c.volumes;
    centavosDe.frete += centavos(c.valorFrete);
    if (a.entregue) t.entregues += 1;
    if (a.teveProblema) t.otifProblemas += 1;
    if (!a.entregue && a.saiuCard) {
      t.emRota += 1;
      const prev = c.dataPrevista;
      if (prev === null) t.emRotaSemPrev += 1;
      else if (prev < hoje) t.emRotaVencida += 1;
      else if (prev === hoje) t.emRotaHoje += 1;
      else t.emRotaFuturo += 1;
    }
    if (!a.entregue && a.finalizado) t.baixadoSemEntrega += 1;
    if (!a.entregue && !a.finalizado && !a.emRota) {
      if (a.travado) {
        t.travado += 1;
        travados.push(item);
      } else t.parado += 1;
    }
  }
  t.tdeRomaneado = t.tdeRomaneadoEmRota + t.tdeRomaneadoEntregue;
  t.travadoMotivo = motivoDosTravados(travados, cadastro);
  t.frete = reais(centavosDe.frete);
  t.prejuizoFrete = reais(centavosDe.prejuizoFrete);
  t.tdeRomaneadoValor = reais(centavosDe.tdeRomaneadoValor);
  return t;
}

// ---------------------------------------------------------------------------------------------
// KPIs, distribuição dos não finalizados e motivos de não entrega

export interface KpisRomaneio {
  total: number;
  romaneado: number;
  entregue: number;
  naoEntregue: number;
  prejudicada: number;
  freteRomaneado: number;
  fretePerdido: number;
}

/** origem: romaneio_kpis (prejudicada exige ter saído — Q15) */
export function kpisDoRomaneio(ctes: readonly CteAnalisado[]): KpisRomaneio {
  const k: KpisRomaneio = {
    total: ctes.length,
    romaneado: 0,
    entregue: 0,
    naoEntregue: 0,
    prejudicada: 0,
    freteRomaneado: 0,
    fretePerdido: 0,
  };
  let romaneadoCentavos = 0;
  let perdidoCentavos = 0;
  for (const { fato: c, analise: a } of ctes) {
    if (a.prejudicado) {
      k.prejudicada += 1;
      perdidoCentavos += centavos(c.valorFrete);
    }
    if (a.saiuEntrega !== "sim") continue;
    k.romaneado += 1;
    romaneadoCentavos += centavos(c.valorFrete);
    if (a.entregue) k.entregue += 1;
    else if (!a.finalizado) k.naoEntregue += 1;
  }
  return { ...k, freteRomaneado: reais(romaneadoCentavos), fretePerdido: reais(perdidoCentavos) };
}

export interface LinhaDistribuicao {
  codigo: number | null;
  descricao: string | null;
  pendencia: boolean;
  qtd: number;
}

/**
 * Não finalizados que saíram para entrega, pelo código atual (efetiva, senão 0174, senão 0013).
 * origem: romaneio_distribuicao_codigos
 */
export function distribuicaoDosNaoFinalizados(
  ctes: readonly CteAnalisado[],
  cadastro: Cadastro,
): LinhaDistribuicao[] {
  const porCodigo = new Map<number | null, number>();
  for (const { fato: c, analise: a } of ctes) {
    if (a.saiuEntrega !== "sim" || a.entregue || a.finalizado) continue;
    const codigo =
      normCodigoOcorr(c.ocorrEfetivaCodigo) ??
      normCodigoOcorr(c.codigo0174) ??
      normCodigoOcorr(c.codigo0013);
    porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + 1);
  }
  return [...porCodigo]
    .map(([codigo, qtd]) => {
      const cad = codigo === null ? undefined : cadastro.codigo(codigo);
      return {
        codigo,
        descricao: cad?.descricao ?? null,
        pendencia: ehTipoPendencia(cad?.tipoSsw ?? null),
        qtd,
      };
    })
    .sort(
      (x, y) =>
        y.qtd - x.qtd || (x.codigo === null ? 1 : y.codigo === null ? -1 : x.codigo - y.codigo),
    );
}

export interface MotivoNaoEntrega {
  codigo: string;
  descricao: string;
  qtd: number;
}

/**
 * Por código de pendência (≠ 85): CT-e distintos com alguma ocorrência do código, em qualquer
 * data (inclusive quarentena). Empate: código crescente.
 * origem: romaneio_motivos_nao_entrega
 */
export function motivosDeNaoEntrega(
  ctes: readonly FatoCte[],
  cadastro: Cadastro,
  limite: number,
): MotivoNaoEntrega[] {
  const porCodigo = new Map<number, number>();
  for (const c of ctes) {
    const codigos = new Set(
      c.ocorrencias.map((o) => o.codigo).filter((k) => ehPendencia(cadastro, k)),
    );
    for (const k of codigos) porCodigo.set(k, (porCodigo.get(k) ?? 0) + 1);
  }
  return [...porCodigo]
    .sort((x, y) => y[1] - x[1] || x[0] - y[0])
    .slice(0, Math.min(100, Math.max(1, limite)))
    .map(([codigo, qtd]) => ({
      codigo: String(codigo),
      descricao: cadastro.codigo(codigo)?.descricao ?? "",
      qtd,
    }));
}
