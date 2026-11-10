/**
 * Linha do tempo de ocorrências do CT-e (ícone na coluna "Última ocorrência" da lista): as
 * ocorrências gravadas mais as linhas do relatório 930 que ainda não viraram ocorrência.
 * Spec: docs/regras/03-romaneio-prazo-parceiro.md §3.11. Com Q02, casa por sigla + número.
 * origem: romaneio_timeline_ocorrencias
 */
import { normCodigoOcorr } from "../nucleo";
import { COLLATOR } from "./normalizacao";

/** Linha do 930 (campos usados aqui). `ocorrenciaEm` já convertido de horário de SP. */
export interface Linha930 {
  ocorrenciaEm: Date | null;
  codigo: string | null;
  descricao: string | null;
  complemento: string | null;
  usuario: string | null;
  unidade: string | null;
  empresa: string | null;
}

export interface OcorrenciaGravada {
  dataHora: Date;
  codigo: number;
  descricao: string | null;
  complemento: string | null;
}

export interface EventoDaLinhaDoTempo {
  dataHora: Date;
  codigo: string | null;
  descricao: string | null;
  complemento: string | null;
  usuario: string | null;
  unidade: string | null;
  fonte: "sistema" | "ssw";
}

export const LIMITE_DA_LINHA_DO_TEMPO = 200;

const textoOuNulo = (t: string | null) => t?.trim() || null;

/** ASC com nulos por último. */
function ascNulosUltimo(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return COLLATOR.compare(a, b);
}

/** Um por (código, instante), com o desempate dado. */
function deduplicar<T extends { codNorm: number | null; dataHora: Date }>(
  itens: readonly T[],
  desempate: (a: T, b: T) => number,
): Map<string, T> {
  const porChave = new Map<string, T>();
  for (const item of [...itens].sort(desempate)) {
    const chave = `${item.codNorm ?? ""}|${item.dataHora.getTime()}`;
    if (!porChave.has(chave)) porChave.set(chave, item);
  }
  return porChave;
}

export function linhaDoTempo(
  ocorrencias: readonly OcorrenciaGravada[],
  linhas930: readonly Linha930[],
): EventoDaLinhaDoTempo[] {
  const ssw = deduplicar(
    linhas930
      .filter((l): l is Linha930 & { ocorrenciaEm: Date } => l.ocorrenciaEm !== null)
      .map((l) => ({
        dataHora: l.ocorrenciaEm,
        codigo: textoOuNulo(l.codigo),
        codNorm: normCodigoOcorr(l.codigo),
        descricao: textoOuNulo(l.descricao),
        complemento: textoOuNulo(l.complemento),
        usuario: textoOuNulo(l.usuario),
        // unid_ocor vazio não cai para empr_ocor (coalesce só troca nulo).
        unidade: textoOuNulo(l.unidade ?? l.empresa),
      })),
    (a, b) => ascNulosUltimo(a.complemento, b.complemento) || ascNulosUltimo(a.usuario, b.usuario),
  );
  const sistema = deduplicar(
    ocorrencias.map((o) => ({
      dataHora: o.dataHora,
      codigo: String(o.codigo),
      codNorm: o.codigo,
      descricao: o.descricao,
      complemento: textoOuNulo(o.complemento),
    })),
    (a, b) => ascNulosUltimo(a.complemento, b.complemento),
  );
  const eventos: EventoDaLinhaDoTempo[] = [];
  for (const [chave, p] of sistema) {
    const x = ssw.get(chave);
    eventos.push({
      dataHora: p.dataHora,
      codigo: p.codigo,
      descricao: p.descricao ?? x?.descricao ?? null,
      complemento: p.complemento ?? x?.complemento ?? null,
      usuario: x?.usuario ?? null,
      unidade: x?.unidade ?? null,
      fonte: "sistema",
    });
  }
  for (const [chave, x] of ssw) {
    if (sistema.has(chave)) continue;
    eventos.push({
      dataHora: x.dataHora,
      codigo: x.codigo,
      descricao: x.descricao,
      complemento: x.complemento,
      usuario: x.usuario,
      unidade: x.unidade,
      fonte: "ssw",
    });
  }
  return eventos
    .sort((a, b) => b.dataHora.getTime() - a.dataHora.getTime())
    .slice(0, LIMITE_DA_LINHA_DO_TEMPO);
}
