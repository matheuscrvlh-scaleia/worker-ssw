/**
 * Romaneio do CT-e pelo 036 (ajudante e ocorrência do romaneio, que entram na ocorrência efetiva).
 * Calculado direto das linhas do 036 no momento da aplicação (Q38 do dono): sem o atraso de até
 * 30 min da matview de hoje. Spec 06 §3.9.
 */
import { type Registro036 } from "../../fontes/relatorios";
import { type CamposDoCte, type CteDaIngestao, instanteSp, type LinhaGuardada } from "./comum";

function textoDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

/**
 * Linha do 036 que vale para o CT-e: importação mais nova, romaneio maior, BAIXADO primeiro,
 * ocorrência e emissão mais recentes.
 * origem: mv_romaneio_036_ctrc (sistema atual)
 */
export function linha036QueVale(
  linhas: readonly LinhaGuardada<Registro036>[],
): LinhaGuardada<Registro036> | null {
  const ordenadas = [...linhas].sort(
    (a, b) =>
      b.importadoEm.getTime() - a.importadoEm.getTime() ||
      textoDesc(a.dados.romaneio, b.dados.romaneio) ||
      Number(b.dados.situacao === "BAIXADO") - Number(a.dados.situacao === "BAIXADO") ||
      textoDesc(a.dados.data_ocorr_ctrc, b.dados.data_ocorr_ctrc) ||
      textoDesc(a.dados.hora_ocorr_ctrc, b.dados.hora_ocorr_ctrc) ||
      textoDesc(a.dados.data_emissao, b.dados.data_emissao),
  );
  return ordenadas[0] ?? null;
}

/** Data e hora da ocorrência do CT-e no 036, em São Paulo (hora vazia = 12:00). */
export function dataOcorrencia036(r: Registro036): Date | null {
  if (r.data_ocorr_ctrc === null) return null;
  const hora = /^\d{1,2}:\d{2}$/.test(r.hora_ocorr_ctrc ?? "")
    ? (r.hora_ocorr_ctrc ?? "")
    : "12:00";
  return instanteSp(`${r.data_ocorr_ctrc}T${hora.padStart(5, "0")}`);
}

/**
 * Campos do CT-e que o 036 muda (só quando algum difere). Romaneio, situação e ajudantes 2/3 não
 * têm leitor no sistema novo (modelo.md "Descartado").
 * origem: aplicar_036_romaneio (sistema atual)
 */
export function camposDo036(
  p: Pick<CteDaIngestao, "ajudanteNome" | "ocorr036Codigo" | "ocorr036Descricao" | "ocorr036Data">,
  v: Registro036,
): CamposDoCte {
  const data = dataOcorrencia036(v);
  const difere =
    p.ajudanteNome !== v.ajudante ||
    p.ocorr036Codigo !== v.cod_ocorr_ctrc ||
    p.ocorr036Data?.getTime() !== data?.getTime();
  if (!difere) return {};
  return {
    ajudanteNome: v.ajudante,
    ocorr036Codigo: v.cod_ocorr_ctrc,
    ocorr036Descricao: v.desc_ocorr_ctrc,
    ocorr036Data: data,
  };
}
