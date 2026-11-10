/** Dados de teste do núcleo: catálogo da FR, ocorrência e CT-e com valores neutros. */
import { type CodigoCadastrado, montarCatalogo, type TipoSsw } from "../nucleo/codigos";
import { type CteNucleo } from "../nucleo/derivar-cte";
import { type OcorrenciaDoCte } from "../nucleo/ocorrencia";

const codigo = (
  numero: number,
  tipoSsw: TipoSsw | null,
  descricao = `Código ${numero}`,
): CodigoCadastrado => ({
  codigo: numero,
  descricao,
  tipoSsw,
  processoSsw: null,
  responsavel: "sistema",
  penaliza: false,
});

/** Catálogo da FR nos exemplos da spec: 12/99… = BAIXA, 85 = PRE_ENTREGA, 88 = INFORMATIVA, 50 sem tipo. */
export const CATALOGO_FR = montarCatalogo([
  codigo(1, "ENTREGA", "ENTREGA REALIZADA"),
  codigo(18, "ENTREGA"),
  codigo(67, "ENTREGA"),
  ...[12, 36, 61, 77, 92, 93, 94, 99].map((n) => codigo(n, "BAIXA")),
  codigo(85, "PRE_ENTREGA", "SAIDA PARA ENTREGA"),
  codigo(88, "INFORMATIVA", "COMPROVANTE DIGITALIZADO"),
  codigo(82, "INFORMATIVA"),
  codigo(84, "INFORMATIVA"),
  codigo(80, "INFORMATIVA"),
  codigo(9, "PENDENCIA_CLIENTE"),
  codigo(50, null, "SEM TIPO"),
]);

export const BAIXA_FR: ReadonlySet<number> = new Set([12, 36, 61, 77, 92, 93, 94, 99]);

let sequencia = 0;

export function ocorrencia(
  codigoOcorrencia: number,
  dataHora: string,
  extra: Partial<OcorrenciaDoCte> = {},
): OcorrenciaDoCte {
  sequencia++;
  return {
    id: `oc-${String(sequencia).padStart(4, "0")}`,
    codigo: codigoOcorrencia,
    descricao: null,
    dataHora: new Date(dataHora),
    filial: null,
    origem: "webhook",
    quarentena: false,
    criadoEm: new Date("2026-11-03T12:00:00Z"),
    ...extra,
  };
}

export function cte(extra: Partial<CteNucleo> = {}): CteNucleo {
  return {
    dataEmissao: "2026-11-03",
    criadoEm: new Date("2026-11-03T10:00:00Z"),
    duplicadoDe: null,
    dataEntregaRealizada: null,
    canceladoEm: null,
    pagadorCnpj: null,
    parceiroCnpj: null,
    filial: null,
    unidadeDestino: null,
    unidadeAtual: null,
    camposSsw: [],
    ultOcorrCodigo0174: null,
    ultOcorrDescricao0174: null,
    ultOcorrData0174: null,
    ultOcorrLocal0174: null,
    ultOcorrInstrucao0174: null,
    ultimaOcorrCodigo0013: null,
    ultimaOcorrData0013: null,
    ocorr036Codigo: null,
    ocorr036Descricao: null,
    ocorr036Data: null,
    ocorrEfetivaCodigo: null,
    ocorrEfetivaDescricao: null,
    ocorrEfetivaData: null,
    ocorrEfetivaFonte: null,
    ocorrEfetivaLocal: null,
    ocorrEfetivaCodigoNum: null,
    dataPrevistaEntrega: null,
    prazoFonte: null,
    dataBasePrazo: null,
    previsaoSswData: null,
    previsaoSswFonte: null,
    previsaoSswDataBase: null,
    dataEmbarque: null,
    dataConclusaoEfetiva: null,
    pagadorCnpjDigitos: null,
    filialEfetiva: null,
    unidadeCidade: null,
    unidadeUf: null,
    prazoPadraoDias: null,
    prazoPadraoData: null,
    statusAtual: null,
    canceladoMesmoDia: false,
    foraUniverso: false,
    ...extra,
  };
}
