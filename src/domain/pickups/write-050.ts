import { type EtapaDeColeta } from "@erp/shared/contracts/pickups";

import { etapaDaSituacao } from "./pickups";
import { type Coleta050, lerRelatorio050, type Relatorio050 } from "./reader-050";

/** O que já está gravado de uma coleta e pesa na nova gravação. */
interface ColetaJaGravada {
  unidade: string;
  numero: number;
  relatorioEmitidoEm: Date;
  prejudicadaHorario: boolean;
  cteSigla: string | null;
  cteNumero: string | null;
  romaneio: string | null;
}

export interface ColetaParaGravar extends Coleta050 {
  etapa: EtapaDeColeta;
  relatorioEmitidoEm: Date;
  arquivoOrigem: string;
}

export const chaveDaColeta = (c: { unidade: string; numero: number }) => `${c.unidade}|${c.numero}`;

/**
 * Decide o que gravar de um 050:
 * - coleta repetida no arquivo: vale a última linha (Q24 do dono);
 * - coleta já gravada a partir de um 050 mais novo fica como está (empate de emissão regrava);
 * - "prejudicada pelo horário" gruda em verdadeiro; CT-e gerado e romaneio não somem;
 * - o histórico é substituído; nada é apagado (coleta que some do relatório fica como estava).
 * origem: importar_coletas_050 (sistema atual)
 */
export function planejarGravacao050(
  relatorio: Relatorio050,
  arquivoOrigem: string,
  jaGravadas: ReadonlyMap<string, ColetaJaGravada>,
): { gravar: ColetaParaGravar[]; lidas: number; ignoradas: number } {
  const emitidoEm = new Date(relatorio.emitidoEm);
  const ultimas = new Map(relatorio.coletas.map((c) => [chaveDaColeta(c), c]));
  const gravar = [...ultimas.values()].flatMap((c): ColetaParaGravar[] => {
    const atual = jaGravadas.get(chaveDaColeta(c));
    if (atual && atual.relatorioEmitidoEm > emitidoEm) return [];
    return [
      {
        ...c,
        etapa: etapaDaSituacao(c.situacao),
        prejudicadaHorario: c.prejudicadaHorario || (atual?.prejudicadaHorario ?? false),
        cteSigla: c.cteSigla ?? atual?.cteSigla ?? null,
        cteNumero: c.cteNumero ?? atual?.cteNumero ?? null,
        romaneio: c.romaneio ?? atual?.romaneio ?? null,
        relatorioEmitidoEm: emitidoEm,
        arquivoOrigem,
      },
    ];
  });
  const lidas = relatorio.coletas.length;
  return { gravar, lidas, ignoradas: lidas - gravar.length };
}

/** Onde a importação do 050 lê e grava (a mesma para a tela e para o FTP). */
export interface RepositorioGravacao050 {
  jaGravadas(
    empresaId: string,
    chaves: { unidade: string; numero: number }[],
  ): Promise<ColetaJaGravada[]>;
  /** Insere ou substitui pela chave (empresa, unidade, número). */
  gravar(empresaId: string, coletas: ColetaParaGravar[], agora: Date): Promise<void>;
}

const BLOCO_DE_GRAVACAO = 500;

/**
 * Importação de um 050 — pela tela de Coletas (API) ou pelo FTP (worker) —, em blocos de 500.
 * Relatório que não é o 050 lança `ErroDeNegocio`. Sem auditoria, como hoje.
 * origem: importar-050.server.ts + importar_coletas_050 (sistema atual)
 */
export async function importarRelatorio050(
  repo: RepositorioGravacao050,
  empresaId: string,
  conteudo: string,
  arquivoOrigem: string,
  agora: Date,
): Promise<{ relatorio: Relatorio050; lidas: number; gravadas: number; ignoradas: number }> {
  const relatorio = lerRelatorio050(conteudo, arquivoOrigem);
  const chaves = [...new Map(relatorio.coletas.map((c) => [chaveDaColeta(c), c])).values()];
  const jaGravadas = new Map<string, ColetaJaGravada>();
  for (let i = 0; i < chaves.length; i += BLOCO_DE_GRAVACAO) {
    for (const g of await repo.jaGravadas(empresaId, chaves.slice(i, i + BLOCO_DE_GRAVACAO))) {
      jaGravadas.set(chaveDaColeta(g), g);
    }
  }
  const plano = planejarGravacao050(relatorio, arquivoOrigem, jaGravadas);
  for (let i = 0; i < plano.gravar.length; i += BLOCO_DE_GRAVACAO) {
    await repo.gravar(empresaId, plano.gravar.slice(i, i + BLOCO_DE_GRAVACAO), agora);
  }
  return {
    relatorio,
    lidas: plano.lidas,
    gravadas: plano.gravar.length,
    ignoradas: plano.ignoradas,
  };
}
