/**
 * Estorno de baixa (código 86, decisão de 03/11/2026): baixa lançada antes de um estorno não vale;
 * estorno seguido de nova baixa sai; estorno sem baixa depois deixa o CT-e aberto e sem entrega.
 * Só o 930 é desfeito. Spec 06 §3.12.
 */
import { CODIGOS_ENTREGA, inicioDoDiaSp } from "@erp/domain/core";

import { codigoOcorrencia, type Registro930 } from "../../fontes/relatorios";
import { instanteSp, type LinhaGuardada, maximo } from "./comum";

export const CODIGO_ESTORNO = 86;

/**
 * Ids das linhas do 930 que não valem. `finalizadores` = entrega (1/18/67) + baixa do cadastro
 * da empresa (Q22 do dono; para a FR, 12/36/61/77/92/93/94/99).
 * origem: ssw_930_anuladas (sistema atual)
 */
export function anuladas930(
  linhas: readonly LinhaGuardada<Registro930>[],
  finalizadores: ReadonlySet<number>,
): Set<number> {
  const porCtrc = new Map<string, { id: number; cod: number | null; incl: string | null }[]>();
  for (const l of linhas) {
    const ctrc = (l.dados.ctrc ?? "").trim();
    const grupo = porCtrc.get(ctrc) ?? [];
    grupo.push({
      id: l.id,
      cod: codigoOcorrencia(l.dados.cod_ocor),
      incl: l.dados.inclusao_em ?? l.dados.ocorrencia_em,
    });
    porCtrc.set(ctrc, grupo);
  }
  const anuladas = new Set<number>();
  for (const grupo of porCtrc.values()) {
    const ehFinalizador = (cod: number | null) => cod !== null && finalizadores.has(cod);
    if (!grupo.some((r) => r.cod === CODIGO_ESTORNO)) continue;
    const ultimoEstorno = maximo(grupo.filter((r) => r.cod === CODIGO_ESTORNO).map((r) => r.incl));
    const ultimaBaixa = maximo(grupo.filter((r) => ehFinalizador(r.cod)).map((r) => r.incl));
    for (const r of grupo) {
      // Comparações com NULL do SQL não passam: sem hora, a linha não é anulada.
      if (
        ehFinalizador(r.cod) &&
        r.incl !== null &&
        ultimoEstorno !== null &&
        r.incl < ultimoEstorno
      ) {
        anuladas.add(r.id);
      }
      if (
        r.cod === CODIGO_ESTORNO &&
        ultimaBaixa !== null &&
        r.incl !== null &&
        r.incl <= ultimaBaixa
      ) {
        anuladas.add(r.id);
      }
    }
  }
  return anuladas;
}

export interface OcorrenciaParaApagar {
  codigo: number;
  dataHora: Date;
}

export interface EfeitoDoEstorno {
  /** Ocorrências do 930 anuladas que saem de `ocorrencias`. */
  apagar: OcorrenciaParaApagar[];
  /** `undefined` = não mexe na entrega; `null` = CT-e volta a ficar sem entrega. */
  entrega: Date | null | undefined;
}

/**
 * O que o estorno muda num CT-e, dadas as linhas do 930 ligadas a ele (mesma emissão).
 * origem: ssw_aplicar_estornos (sistema atual)
 */
export function efeitoDoEstorno(
  linhas: readonly LinhaGuardada<Registro930>[],
  anuladas: ReadonlySet<number>,
  finalizadores: ReadonlySet<number>,
  entregaAtual: Date | null,
): EfeitoDoEstorno {
  if (!linhas.some((l) => anuladas.has(l.id))) return { apagar: [], entrega: undefined };
  const validas = linhas.filter((l) => !anuladas.has(l.id));
  const cod = (l: LinhaGuardada<Registro930>) => codigoOcorrencia(l.dados.cod_ocor);
  const apagar: OcorrenciaParaApagar[] = [];
  for (const l of linhas) {
    const c = cod(l);
    const em = l.dados.ocorrencia_em;
    if (!anuladas.has(l.id) || c === null || em === null) continue;
    // Baixa relançada idêntica é a mesma linha em `ocorrencias`: não apaga.
    if (validas.some((v) => cod(v) === c && v.dados.ocorrencia_em === em)) continue;
    apagar.push({ codigo: c, dataHora: instanteSp(em) });
  }
  const temBaixa = validas.some((l) => {
    const c = cod(l);
    return c !== null && finalizadores.has(c);
  });
  let nova: Date | null = null;
  if (temBaixa) {
    const entregaEm = maximo(
      validas.filter((l) => CODIGOS_ENTREGA.has(cod(l) ?? -1)).map((l) => l.dados.ocorrencia_em),
    );
    const dataEntrega = maximo(
      validas.filter((l) => cod(l) !== CODIGO_ESTORNO).map((l) => l.dados.data_entrega),
    );
    nova = entregaEm ? instanteSp(entregaEm) : dataEntrega ? inicioDoDiaSp(dataEntrega) : null;
  }
  const grava = (nova !== null || !temBaixa) && nova?.getTime() !== entregaAtual?.getTime();
  return { apagar, entrega: grava ? nova : undefined };
}
