/**
 * Ponto de entrada de quem grava CT-e ou ocorrência (API e worker). Substitui os gatilhos de
 * `ctrcs` e `ocorrencias`: o caso de uso carrega o CT-e, as ocorrências dele, o catálogo, as
 * filiais, as regras de prazo e a configuração da empresa; chama `prepararGravacaoDoCte`; e grava
 * o resultado (e a troca de previsão) na mesma transação.
 *
 * Diferente de hoje, **todos** os derivados são recalculados em toda gravação, e a efetiva usa a
 * emissão já ancorada na 80 (Q20 do dono). A exceção é o `status_atual`, que (como hoje) só é
 * refeito quando a gravação mexe nas ocorrências do CT-e (`ocorrenciasMudaram`).
 */
import { ehFonteBi2, type FonteDaEscrita, mesclarEscritaBi2 } from "./bi2";
import { type CatalogoDeCodigos, codigosDeBaixa, normCodigoOcorr } from "./codes";
import { dataConclusaoEfetiva } from "./completion";
import { type ConfiguracaoDoNucleo } from "./configuration";
import {
  type CteParaPrazo,
  definirPrevisao,
  prazoPadraoData,
  prazoPadraoDias,
  type PrevisaoComMemoria,
  type RegraDePrazo,
  type TrocaDePrevisao,
  trocaDePrevisao,
} from "./deadline";
import {
  calcularOcorrenciaEfetiva,
  type FontesDaEfetiva,
  type OcorrenciaEfetiva,
  statusAtual,
} from "./effective-occurrence";
import { cidadeDaFilial, type FilialCadastrada } from "./master-data";
import { type OcorrenciaDoCte } from "./occurrence";
import { dataEmbarque, emissaoAncoradaNo80 } from "./occurrence-write";
import { somenteDigitos } from "./text";
import { type DataIso } from "./time";
import { abaixoDaDataMinima, canceladoMesmoDia, foraDoUniverso } from "./universe";

/** Colunas do CT-e que o núcleo lê ou recalcula. A linha do repositório estende esta. */
export interface CteNucleo extends FontesDaEfetiva, OcorrenciaEfetiva, CteParaPrazo {
  criadoEm: Date;
  duplicadoDe: string | null;
  dataEntregaRealizada: Date | null;
  /** Instante do cancelamento pelo XML (lido pela trava do BI2). */
  canceladoEm: Date | null;
  pagadorCnpj: string | null;
  unidadeDestino: string | null;
  unidadeAtual: string | null;
  camposSsw: readonly string[];
  // Derivados
  dataEmbarque: DataIso | null;
  dataConclusaoEfetiva: DataIso | null;
  pagadorCnpjDigitos: string | null;
  filialEfetiva: string | null;
  unidadeCidade: string | null;
  unidadeUf: string | null;
  prazoPadraoDias: number | null;
  prazoPadraoData: DataIso | null;
  statusAtual: string | null;
  ocorrEfetivaCodigoNum: number | null;
  canceladoMesmoDia: boolean;
  foraUniverso: boolean;
}

/** Tudo o que o caso de uso carrega da empresa do CT-e antes de derivar. */
export interface ContextoDoCte {
  /** Todas as ocorrências do CT-e já gravadas (inclusive a que acabou de entrar). */
  ocorrencias: readonly OcorrenciaDoCte[];
  catalogo: CatalogoDeCodigos;
  filiais: readonly FilialCadastrada[];
  regrasDePrazo: readonly RegraDePrazo[];
  config: ConfiguracaoDoNucleo;
  /**
   * `true` quando esta gravação inseriu, alterou ou apagou ocorrência do CT-e (ou o catálogo dos
   * códigos dele mudou). Só então o `status_atual` é refeito pelas ocorrências; nas demais vale o
   * gravado, inclusive o escrito pelo chamador (ex.: "CANCELADO" do XML).
   * origem: trg_sync_status_atual roda só na gravação de ocorrência (sistema atual)
   */
  ocorrenciasMudaram: boolean;
}

/** Colunas que o núcleo escreve. */
export type DerivadosDoCte = Pick<
  CteNucleo,
  | "dataEmissao"
  | "unidadeCidade"
  | "unidadeUf"
  | "filialEfetiva"
  | "pagadorCnpjDigitos"
  | "canceladoMesmoDia"
  | "ocorrEfetivaCodigoNum"
  | "dataConclusaoEfetiva"
  | "prazoPadraoDias"
  | "prazoPadraoData"
  | "dataEmbarque"
  | "statusAtual"
  | "foraUniverso"
> &
  OcorrenciaEfetiva &
  PrevisaoComMemoria;

/**
 * Recalcula todos os derivados do CT-e, nesta ordem (cada passo usa os anteriores): emissão pela
 * 80 → cidade da filial → filial efetiva e dígitos do pagador → cancelado no mesmo dia →
 * ocorrência efetiva → data de conclusão → previsão (regra configurada ou SSW) → prazo padrão →
 * embarque → status atual → fora do universo.
 */
export function recalcularDerivadosDoCte(cte: CteNucleo, contexto: ContextoDoCte): DerivadosDoCte {
  const { ocorrencias, catalogo, config } = contexto;
  const dataEmissao = emissaoAncoradaNo80(cte, ocorrencias);
  const cancelado = canceladoMesmoDia(dataEmissao, ocorrencias);
  const efetiva = calcularOcorrenciaEfetiva({ ...cte, dataEmissao }, ocorrencias, catalogo);
  const previsao = definirPrevisao({ ...cte, dataEmissao }, ocorrencias, contexto.regrasDePrazo);
  const diasPadrao = prazoPadraoDias(cte.pagadorCnpj, cte.parceiroCnpj, config);
  return {
    dataEmissao,
    ...cidadeDaFilial(cte, contexto.filiais),
    // origem: coalesce(unidade_destino, unidade_atual, filial) das RPCs (sistema atual)
    filialEfetiva: cte.unidadeDestino ?? cte.unidadeAtual ?? cte.filial,
    pagadorCnpjDigitos: cte.pagadorCnpj === null ? null : somenteDigitos(cte.pagadorCnpj),
    canceladoMesmoDia: cancelado,
    ...efetiva,
    ocorrEfetivaCodigoNum: normCodigoOcorr(efetiva.ocorrEfetivaCodigo),
    dataConclusaoEfetiva: dataConclusaoEfetiva(
      { ...efetiva, dataEntregaRealizada: cte.dataEntregaRealizada },
      codigosDeBaixa(catalogo),
    ),
    ...previsao,
    prazoPadraoDias: diasPadrao,
    prazoPadraoData: prazoPadraoData(dataEmissao, previsao.dataPrevistaEntrega, diasPadrao),
    dataEmbarque: dataEmbarque(ocorrencias) ?? cte.dataEmbarque,
    statusAtual:
      (contexto.ocorrenciasMudaram ? statusAtual(ocorrencias, catalogo) : null) ?? cte.statusAtual,
    foraUniverso: foraDoUniverso(cancelado, cte.duplicadoDe),
  };
}

export type MotivoDoDescarte =
  "abaixo_da_data_minima" | "bi2_nao_cria_cte" | "bi2_nao_altera_cte_em_andamento";

type GravacaoDoCte<T> =
  | { tipo: "descartar"; motivo: MotivoDoDescarte }
  | {
      tipo: "gravar";
      cte: T;
      /** `false` = linha igual à gravada: não gravar (nem histórico, nem `atualizado_em`). */
      mudou: boolean;
      /** Linha para `cte_prazo_historico`, quando a previsão mudou e a anterior não era nula. */
      trocaDePrevisao: TrocaDePrevisao | null;
    };

/**
 * Decide a gravação de um CT-e: `antigo` = linha gravada (`null` na criação); `novo` = antigo com
 * o que chegou aplicado por cima; `fonte` = quem grava.
 * origem: gatilhos _trg_ctrcs_* e trg_ctrcs_zzz_ignora_update_identico (sistema atual)
 */
export function prepararGravacaoDoCte<T extends CteNucleo>(entrada: {
  antigo: T | null;
  novo: T;
  fonte: FonteDaEscrita;
  contexto: ContextoDoCte;
}): GravacaoDoCte<T> {
  const { antigo, novo, fonte, contexto } = entrada;
  let base = novo;
  if (antigo === null) {
    if (abaixoDaDataMinima(novo.dataEmissao, contexto.config.dataMinimaEmissao)) {
      return { tipo: "descartar", motivo: "abaixo_da_data_minima" };
    }
    if (ehFonteBi2(fonte)) return { tipo: "descartar", motivo: "bi2_nao_cria_cte" };
  } else {
    const mesclado = mesclarEscritaBi2(antigo, novo, fonte, codigosDeBaixa(contexto.catalogo));
    if (mesclado === "descartar") {
      return { tipo: "descartar", motivo: "bi2_nao_altera_cte_em_andamento" };
    }
    base = mesclado;
  }
  const cte: T = { ...base, ...recalcularDerivadosDoCte(base, contexto) };
  if (antigo === null) return { tipo: "gravar", cte, mudou: true, trocaDePrevisao: null };
  const mudou = !mesmosValores(antigo, cte);
  return {
    tipo: "gravar",
    cte,
    mudou,
    trocaDePrevisao: mudou ? trocaDePrevisao(antigo.dataPrevistaEntrega, cte) : null,
  };
}

/** Igualdade campo a campo (datas pelo instante, listas item a item). */
function mesmosValores(a: object, b: object): boolean {
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...chaves].every((chave) => mesmoValor(Reflect.get(a, chave), Reflect.get(b, chave)));
}

function mesmoValor(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => mesmoValor(item, b[i]));
  }
  return a === b;
}
