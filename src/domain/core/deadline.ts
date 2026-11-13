/**
 * Prazo do CT-e: dias úteis, prazo padrão (mínimo 48 h corridas / nascido em atraso), prazos
 * configurados no Admin e histórico de previsão.
 */
/** De onde veio a previsão gravada (`ctes.prazo_fonte`). */
import type { FontePrazo } from "@erp/shared/domain/deadline";

import { CODIGO_CHEGADA_NA_UNIDADE } from "./codes";
import { foraDeQuarentena, type OcorrenciaDoCte } from "./occurrence";
import { somenteDigitos } from "./text";
import {
  type DataIso,
  diaSp,
  ehDiaDeSemana,
  inicioDoDiaSp,
  menorInstante,
  somarDiasCorridos,
  somarHoras,
} from "./time";
export { type FontePrazo, FONTES_DE_PRAZO } from "@erp/shared/domain/deadline";

type FonteDeRegra = Extract<FontePrazo, `regra_${string}`>;

export function ehFonteDeRegra(fonte: FontePrazo | null): fonte is FonteDeRegra {
  return fonte === "regra_parceiro" || fonte === "regra_transbordo" || fonte === "regra_unidade";
}

// --- Dias úteis ------------------------------------------------------------------------------

/**
 * Feriados que pulam o dia útil: só os nacionais (Q23 do dono), entre os que a empresa enxerga
 * (nacional da Plataforma, empresa nula, ou nacional cadastrado pela própria empresa — Q28).
 */
export function feriadosQueContamNosDiasUteis(
  feriados: readonly { data: DataIso; tipo: string }[],
): ReadonlySet<DataIso> {
  return new Set(feriados.filter((f) => f.tipo === "nacional").map((f) => f.data));
}

/**
 * Dias úteis no intervalo (menor, maior] com sinal: positivo se `entrega` é depois da previsão.
 * Útil = segunda a sexta e não feriado.
 * origem: _dias_uteis_sla (sistema atual)
 */
export function diasUteisEntre(
  previsao: DataIso | null,
  entrega: DataIso | null,
  feriados: ReadonlySet<DataIso>,
): number | null {
  if (previsao === null || entrega === null) return null;
  if (previsao === entrega) return 0;
  const [de, ate] = previsao < entrega ? [previsao, entrega] : [entrega, previsao];
  let uteis = 0;
  for (let d = somarDiasCorridos(de, 1); d <= ate; d = somarDiasCorridos(d, 1)) {
    if (ehDiaDeSemana(d) && !feriados.has(d)) uteis++;
  }
  return entrega > previsao ? uteis : -uteis;
}

// --- Prazo padrão (mínimo 48 h) e nascido em atraso ------------------------------------------

/** Valores da empresa que hoje são fixos para a FR (Q48 do dono). */
export interface ConfiguracaoDoPrazoPadrao {
  /** Dias corridos do prazo mínimo (FR: 2 = 48 h). */
  prazoPadraoDias: number;
  /** Raiz de CNPJ (8 dígitos) do cliente fora do indicador (FR: TROCA, 00193687). */
  raizCnpjTroca: string | null;
}

/**
 * Nulo quando o pagador ou o parceiro é o cliente TROCA.
 * origem: prazo_padrao_do_ctrc (sistema atual); decisão nascido-em-atraso-48h-corridas-2026-10-13
 */
export function prazoPadraoDias(
  pagadorCnpj: string | null,
  parceiroCnpj: string | null,
  config: ConfiguracaoDoPrazoPadrao,
): number | null {
  const raiz = (cnpj: string | null) => somenteDigitos(cnpj).slice(0, 8);
  const ehTroca =
    config.raizCnpjTroca !== null &&
    (raiz(pagadorCnpj) === config.raizCnpjTroca || raiz(parceiroCnpj) === config.raizCnpjTroca);
  return ehTroca ? null : config.prazoPadraoDias;
}

/**
 * Emissão + dias corridos; nula ("não avaliado") se a previsão é anterior à emissão. Previsão
 * nula ainda gera a data.
 * origem: prazo_padrao_data_do_ctrc (sistema atual)
 */
export function prazoPadraoData(
  emissao: DataIso,
  previsao: DataIso | null,
  dias: number | null,
): DataIso | null {
  if (previsao !== null && previsao < emissao) return null;
  return dias === null ? null : somarDiasCorridos(emissao, dias);
}

// --- Prazos configurados (Admin) -------------------------------------------------------------

/** Linha de `prazos_configurados`. */
export interface RegraDePrazo {
  id: string;
  tipo: "unidade" | "parceiro" | "transbordo";
  unidadeCodigo: string | null;
  unidadeDestinoCodigo: string | null;
  parceiroCnpj: string | null;
  prazoHoras: number | null;
  prazoDias: number | null;
  ativo: boolean;
  criadoEm: Date;
}

/** Colunas de previsão do CT-e. */
export interface Previsao {
  dataPrevistaEntrega: DataIso | null;
  prazoFonte: FontePrazo | null;
  dataBasePrazo: Date | null;
}

/**
 * Previsão do CT-e com a memória da previsão do SSW. A regra configurada sobrescreve a previsão,
 * mas a do SSW fica guardada para voltar quando a regra sair (Q19 do dono).
 */
export interface PrevisaoComMemoria extends Previsao {
  previsaoSswData: DataIso | null;
  previsaoSswFonte: FontePrazo | null;
  previsaoSswDataBase: Date | null;
}

export interface CteParaPrazo extends PrevisaoComMemoria {
  dataEmissao: DataIso;
  filial: string | null;
  parceiroCnpj: string | null;
}

/**
 * Aplica a regra configurada que vale para o CT-e — parceiro › transbordo › unidade — ou, sem
 * regra, a previsão do SSW. Roda em toda gravação do CT-e e de ocorrência (chegada 84), então vale
 * para CT-e novo (Q19 do dono; hoje só quando alguém salva uma regra). Quem grava uma previsão do
 * SSW grava também uma `prazo_fonte` que não é `regra_*`.
 * origem: aplicar_prazo_configurado, limpar_prazos_regras_orfas, recalcular_todos_prazos_configurados (sistema atual)
 */
export function definirPrevisao(
  cte: CteParaPrazo,
  ocorrencias: readonly OcorrenciaDoCte[],
  regras: readonly RegraDePrazo[],
): PrevisaoComMemoria {
  const ssw: Previsao = ehFonteDeRegra(cte.prazoFonte)
    ? {
        dataPrevistaEntrega: cte.previsaoSswData,
        prazoFonte: cte.previsaoSswFonte,
        dataBasePrazo: cte.previsaoSswDataBase,
      }
    : {
        dataPrevistaEntrega: cte.dataPrevistaEntrega,
        prazoFonte: cte.prazoFonte,
        dataBasePrazo: cte.dataBasePrazo,
      };
  return {
    ...(previsaoPorRegra(cte, ocorrencias, regras) ?? ssw),
    previsaoSswData: ssw.dataPrevistaEntrega,
    previsaoSswFonte: ssw.prazoFonte,
    previsaoSswDataBase: ssw.dataBasePrazo,
  };
}

/** Previsão dada pelas regras ativas, ou `null` se nenhuma vale para o CT-e. */
function previsaoPorRegra(
  cte: Pick<CteParaPrazo, "dataEmissao" | "filial" | "parceiroCnpj">,
  ocorrencias: readonly OcorrenciaDoCte[],
  regras: readonly RegraDePrazo[],
): Previsao | null {
  const ativas = regras.filter((r) => r.ativo).sort(ordemDeAplicacao);
  return (
    porParceiro(cte, ativas) ??
    porTransbordo(cte, ocorrencias, ativas) ??
    porUnidade(cte, ocorrencias, ativas)
  );
}

/**
 * Entre regras do mesmo tipo, vale a última na ordem de criação (é a que ficaria gravada ao
 * aplicar uma depois da outra).
 */
function ordemDeAplicacao(a: RegraDePrazo, b: RegraDePrazo): number {
  return a.criadoEm.getTime() - b.criadoEm.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function ultima<T>(itens: readonly T[]): T | null {
  return itens.at(-1) ?? null;
}

/** Emissão + dias corridos, base = meia-noite de Brasília da emissão. Igualdade de texto do CNPJ. */
function porParceiro(
  cte: Pick<CteParaPrazo, "dataEmissao" | "parceiroCnpj">,
  regras: readonly RegraDePrazo[],
): Previsao | null {
  const regra = ultima(
    regras.filter(
      (r) =>
        r.tipo === "parceiro" && r.parceiroCnpj !== null && r.parceiroCnpj === cte.parceiroCnpj,
    ),
  );
  if (regra?.prazoDias == null) return null;
  return {
    dataPrevistaEntrega: somarDiasCorridos(cte.dataEmissao, regra.prazoDias),
    prazoFonte: "regra_parceiro",
    dataBasePrazo: inicioDoDiaSp(cte.dataEmissao),
  };
}

/** Dia (Brasília) da 1ª chegada (84) no destino + dias corridos, base = a chegada. */
function porTransbordo(
  cte: Pick<CteParaPrazo, "filial">,
  ocorrencias: readonly OcorrenciaDoCte[],
  regras: readonly RegraDePrazo[],
): Previsao | null {
  const aplicaveis = regras.flatMap((r) => {
    if (r.tipo !== "transbordo" || r.prazoDias === null || r.unidadeCodigo !== cte.filial)
      return [];
    const chegada = chegadaNaUnidade(ocorrencias, r.unidadeDestinoCodigo);
    return chegada === null ? [] : [{ dias: r.prazoDias, chegada }];
  });
  const escolhida = ultima(aplicaveis);
  if (escolhida === null) return null;
  return {
    dataPrevistaEntrega: somarDiasCorridos(diaSp(escolhida.chegada), escolhida.dias),
    prazoFonte: "regra_transbordo",
    dataBasePrazo: escolhida.chegada,
  };
}

/** Dia (Brasília) de 1ª chegada (84) na própria filial + horas, base = a chegada. */
function porUnidade(
  cte: Pick<CteParaPrazo, "filial">,
  ocorrencias: readonly OcorrenciaDoCte[],
  regras: readonly RegraDePrazo[],
): Previsao | null {
  const regra = ultima(
    regras.filter(
      (r) => r.tipo === "unidade" && r.unidadeCodigo !== null && r.unidadeCodigo === cte.filial,
    ),
  );
  if (regra?.prazoHoras == null) return null;
  const chegada = chegadaNaUnidade(ocorrencias, regra.unidadeCodigo);
  if (chegada === null) return null;
  return {
    dataPrevistaEntrega: diaSp(somarHoras(chegada, regra.prazoHoras)),
    prazoFonte: "regra_unidade",
    dataBasePrazo: chegada,
  };
}

/** Primeira 84 lançada na filial (quarentena fora — Q21 do dono). */
function chegadaNaUnidade(
  ocorrencias: readonly OcorrenciaDoCte[],
  sigla: string | null,
): Date | null {
  if (sigla === null) return null;
  return menorInstante(
    foraDeQuarentena(ocorrencias)
      .filter((o) => o.codigo === CODIGO_CHEGADA_NA_UNIDADE && o.filial === sigla)
      .map((o) => o.dataHora),
  );
}

// --- Histórico de previsão -------------------------------------------------------------------

export interface TrocaDePrevisao {
  dataAnterior: DataIso;
  dataNova: DataIso | null;
  /** `prazo_fonte` novo do CT-e. */
  fonte: FontePrazo | null;
}

/**
 * Linha de `cte_prazo_historico` quando a previsão muda e a anterior não era nula (a primeira
 * previsão não gera linha).
 * origem: _trg_ctrcs_log_prazo (sistema atual)
 */
export function trocaDePrevisao(
  anterior: DataIso | null,
  nova: Pick<Previsao, "dataPrevistaEntrega" | "prazoFonte">,
): TrocaDePrevisao | null {
  if (anterior === null || anterior === nova.dataPrevistaEntrega) return null;
  return { dataAnterior: anterior, dataNova: nova.dataPrevistaEntrega, fonte: nova.prazoFonte };
}
