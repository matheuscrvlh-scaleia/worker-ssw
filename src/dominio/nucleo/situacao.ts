/**
 * Atraso e recortes de situação do CT-e: sem movimento, faixa e status do previsto, saiu para
 * entrega e em rota.
 */
import {
  CODIGO_SAIDA_PARA_ENTREGA,
  codigoNumericoOuNulo,
  CODIGOS_ENTREGA,
  CODIGOS_SAIU_ENTREGA,
  normCodigoOcorr,
  TIPOS_PENDENCIA,
  type TipoSsw,
} from "./codigos";
import { estaEntregue, estaFinalizadoSemEntrega } from "./finalizacao";
import { foraDeQuarentena, type OcorrenciaDoCte } from "./ocorrencia";
import { type DataIso, diaSp, difDias, hojeSp, inicioDoDiaSp, somarDiasCorridos } from "./tempo";

/** Colunas do CT-e que as regras de situação leem. */
export interface CteParaSituacao {
  dataEmissao: DataIso;
  criadoEm: Date;
  dataPrevistaEntrega: DataIso | null;
  dataEntregaRealizada: Date | null;
  ocorrEfetivaCodigo: string | null;
  ocorrEfetivaData: Date | null;
  performanceDias: number | null;
  responsabilidadeCliente: boolean | null;
  ultimaOcorrCodigo0013: string | null;
  ultOcorrCodigo0174: string | null;
}

/**
 * Atraso pela previsão atual: entregue = dia da entrega (Brasília) − previsão; efetiva de entrega
 * sem data = `performance_dias`; baixado = vazio; aberto = hoje (Brasília) − previsão. Negativo =
 * ainda no prazo. `ctes.atraso_dias` (foto do 0013) não entra.
 * origem: atraso_lista_dias (sistema atual) e src/lib/atraso.ts; decisão atraso-pela-previsao-atual-2026-11-05
 */
export function atrasoDias(
  cte: Pick<
    CteParaSituacao,
    "dataPrevistaEntrega" | "dataEntregaRealizada" | "ocorrEfetivaCodigo" | "performanceDias"
  >,
  codigosBaixa: ReadonlySet<number>,
  agora: Date,
): number | null {
  const prevista = cte.dataPrevistaEntrega;
  if (prevista === null) return null;
  if (cte.dataEntregaRealizada !== null) return difDias(diaSp(cte.dataEntregaRealizada), prevista);
  const codigo = normCodigoOcorr(cte.ocorrEfetivaCodigo);
  if (codigo !== null && CODIGOS_ENTREGA.has(codigo)) return cte.performanceDias;
  if (codigo !== null && codigosBaixa.has(codigo)) return null;
  return difDias(hojeSp(agora), prevista);
}

/**
 * Em aberto, sem responsabilidade do cliente, atraso acima do limite e mais de `limite` dias
 * desde o último movimento (dia da efetiva; sem ela, a emissão).
 * origem: regra inline de _lista_ctrcs_detalhado_filtro e performance_alertas (sistema atual)
 */
export function estaSemMovimento(
  cte: CteParaSituacao,
  limite: number,
  codigosBaixa: ReadonlySet<number>,
  agora: Date,
): boolean {
  if (estaEntregue(cte.dataEntregaRealizada, cte.ocorrEfetivaCodigo)) return false;
  if (estaFinalizadoSemEntrega(cte.dataEntregaRealizada, cte.ocorrEfetivaCodigo, codigosBaixa)) {
    return false;
  }
  if (cte.responsabilidadeCliente === true) return false;
  const atraso = atrasoDias(cte, codigosBaixa, agora);
  if (atraso === null || atraso <= limite) return false;
  const ultimoMovimento =
    cte.ocorrEfetivaData === null ? cte.dataEmissao : diaSp(cte.ocorrEfetivaData);
  return difDias(hojeSp(agora), ultimoMovimento) > limite;
}

type FaixaPrevisao = "sem_prev" | "vencido" | "hoje" | "d1" | "d2" | "d3_mais";

/**
 * Faixa de vencimento do bloco "Previstos". "Hoje" é o dia de Brasília (Q11 do dono; hoje o SQL
 * usa o dia UTC da sessão).
 * origem: _bucket_faixa_prev (sistema atual)
 */
export function faixaPrevisao(previsao: DataIso | null, agora: Date): FaixaPrevisao {
  if (previsao === null) return "sem_prev";
  const hoje = hojeSp(agora);
  if (previsao < hoje) return "vencido";
  if (previsao === hoje) return "hoje";
  if (previsao === somarDiasCorridos(hoje, 1)) return "d1";
  if (previsao === somarDiasCorridos(hoje, 2)) return "d2";
  return "d3_mais";
}

export type StatusPrevisto = "agendamento" | "rota" | "pendencia" | "programacao" | "outros";

/**
 * Status do previsto pela efetiva (a ordem importa: 35 com tipo pendência é agendamento).
 * origem: _bucket_status_previsto (sistema atual)
 */
export function statusPrevisto(codigo: number | null, tipoSsw: TipoSsw | null): StatusPrevisto {
  if (codigo === 35) return "agendamento";
  if (codigo === 85 || codigo === 7) return "rota";
  if (tipoSsw !== null && TIPOS_PENDENCIA.has(tipoSsw)) return "pendencia";
  if (codigo === null || [80, 82, 83, 84].includes(codigo)) return "programacao";
  return "outros";
}

type SaiuParaEntrega = "sim" | "quarentena" | "nao_rastreado";

/**
 * Saiu para entrega: entregue, ou efetiva/0013/0174 de saída, ou ocorrência de saída fora de
 * quarentena. Só em quarentena = "quarentena". Código com letra conta como sem código (Q54).
 * origem: _saiu_entrega_status (sistema atual)
 */
export function saiuParaEntrega(
  cte: CteParaSituacao,
  ocorrencias: readonly OcorrenciaDoCte[],
): SaiuParaEntrega {
  if (estaEntregue(cte.dataEntregaRealizada, cte.ocorrEfetivaCodigo)) return "sim";
  for (const coluna of [
    cte.ocorrEfetivaCodigo,
    cte.ultimaOcorrCodigo0013,
    cte.ultOcorrCodigo0174,
  ]) {
    const codigo = codigoNumericoOuNulo(coluna);
    if (codigo !== null && CODIGOS_SAIU_ENTREGA.has(codigo)) return "sim";
  }
  const saidas = ocorrencias.filter((o) => CODIGOS_SAIU_ENTREGA.has(o.codigo));
  if (saidas.length === 0) return "nao_rastreado";
  return saidas.some((o) => !o.quarentena) ? "sim" : "quarentena";
}

/**
 * Em rota: efetiva 85 e (85 só de foto, ou alguma 85 gravada a partir da meia-noite de Brasília
 * da emissão e lançada depois de o CT-e existir). Quarentena não conta (Q21); o corte é o dia de
 * Brasília (Q11; hoje é a meia-noite UTC).
 * origem: _romaneio_em_rota (sistema atual)
 */
export function emRota(
  cte: Pick<CteParaSituacao, "ocorrEfetivaCodigo" | "dataEmissao" | "criadoEm">,
  ocorrencias: readonly OcorrenciaDoCte[],
): boolean {
  if (normCodigoOcorr(cte.ocorrEfetivaCodigo) !== CODIGO_SAIDA_PARA_ENTREGA) return false;
  const saidas = foraDeQuarentena(ocorrencias).filter(
    (o) => o.codigo === CODIGO_SAIDA_PARA_ENTREGA,
  );
  if (saidas.length === 0) return true;
  const corte = inicioDoDiaSp(cte.dataEmissao);
  return saidas.some((o) => o.dataHora >= corte && o.criadoEm >= cte.criadoEm);
}
