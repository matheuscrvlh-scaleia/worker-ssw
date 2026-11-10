/** Ocorrência do CT-e já gravada (linha de `ocorrencias`), no formato que o núcleo lê. */
export interface OcorrenciaDoCte {
  id: string;
  codigo: number;
  descricao: string | null;
  dataHora: Date;
  /** Filial (sigla SSW) onde a ocorrência foi lançada. */
  filial: string | null;
  /** Canal de entrada: webhook, ssw_930, trackingdanfe, manual... */
  origem: string;
  quarentena: boolean;
  criadoEm: Date;
}

export const ORIGEM_TRACKINGDANFE = "trackingdanfe";

/** Quarentena fica fora de todas as contas (Q21 do dono). */
export function foraDeQuarentena(ocorrencias: readonly OcorrenciaDoCte[]): OcorrenciaDoCte[] {
  return ocorrencias.filter((o) => !o.quarentena);
}

/**
 * Mais recente primeiro; empate de `dataHora` pela gravada por último (`criadoEm`, depois `id`),
 * em vez da ordem ao acaso de hoje (Q07 do dono).
 */
export function maisRecentePrimeiro(a: OcorrenciaDoCte, b: OcorrenciaDoCte): number {
  return (
    b.dataHora.getTime() - a.dataHora.getTime() ||
    b.criadoEm.getTime() - a.criadoEm.getTime() ||
    (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
  );
}
