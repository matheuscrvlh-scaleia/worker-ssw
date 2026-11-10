/**
 * Ciclo de importação ("ciclo" = carimbo `aaaa-mm-dd_hhmm` do nome do arquivo) e a fila de
 * aplicação. Spec 06 §3.11.1 e §3.13.
 */
import { diaSp, somarDiasCorridos } from "@erp/dominio/nucleo";

export const STATUS_CICLO_ABERTO = [
  "aberto",
  "importando",
  "aplicando",
  "travado",
  "pausado_freio",
  "erro",
] as const;

export type StatusArquivo =
  "observado" | "importando" | "importado" | "ignorado" | "erro" | "descartado";

export interface RelatorioEsperado {
  relatorio: string;
  porUnidade: boolean;
  unidadesEsperadas: readonly string[];
  obrigatorioNoCiclo: boolean;
  ativo: boolean;
}

export interface ArquivoDoCiclo {
  relatorio: string | null;
  unidade: string | null;
  status: string;
}

export interface AvaliacaoDoCiclo {
  faltantes: string[];
  motivo: string | null;
  /** Algum arquivo importado: o ciclo pode ser aplicado (não há freio nem lote completo). */
  podeFechar: boolean;
}

/** origem: ciclo.server.ts avaliarCiclo (sistema atual) */
export function avaliarCiclo(
  arquivos: readonly ArquivoDoCiclo[],
  esperados: readonly RelatorioEsperado[],
): AvaliacaoDoCiclo {
  const importados = arquivos.filter((a) => a.status === "importado");
  const faltantes: string[] = [];
  for (const e of esperados) {
    if (!e.ativo || !e.obrigatorioNoCiclo) continue;
    const doTipo = importados.filter((a) => a.relatorio === e.relatorio);
    if (e.porUnidade && e.unidadesEsperadas.length > 0) {
      for (const u of e.unidadesEsperadas) {
        if (!doTipo.some((a) => a.unidade === u)) faltantes.push(`${e.relatorio}/${u}`);
      }
    } else if (doTipo.length === 0) {
      faltantes.push(e.relatorio);
    }
  }
  return {
    faltantes,
    motivo: faltantes.length ? `relatórios ausentes neste lote: ${faltantes.join(", ")}` : null,
    podeFechar: importados.length > 0,
  };
}

/** Hora (São Paulo) a partir da qual a fila é refeita por inteiro, uma vez por dia. */
export const HORA_DA_PREPARACAO_COMPLETA = "03:00";

/**
 * A fila é refeita por inteiro quando não há preparação registrada ou a última completa é
 * anterior ao último corte das 03:00 de São Paulo.
 * origem: ssw_fila_preparar_incremental (sistema atual)
 */
export function precisaPreparacaoCompleta(
  agora: Date,
  controle: { ultimaPreparacaoEm: Date | null; ultimaCompletaEm: Date | null },
): boolean {
  if (controle.ultimaPreparacaoEm === null || controle.ultimaCompletaEm === null) return true;
  const hoje = diaSp(agora);
  let corte = new Date(`${hoje}T${HORA_DA_PREPARACAO_COMPLETA}:00-03:00`);
  if (agora < corte)
    corte = new Date(`${somarDiasCorridos(hoje, -1)}T${HORA_DA_PREPARACAO_COMPLETA}:00-03:00`);
  return controle.ultimaCompletaEm < corte;
}

/** Mensagem da sincronização do FTP (spec 06 §3.1, passo 8). */
export function mensagemDaSincronizacao(r: {
  movidos: number;
  comErro: number;
  pastasLimpas: number;
}): string {
  const pastas = r.pastasLimpas > 0 ? `${r.pastasLimpas} pasta(s) antiga(s) removida(s)` : null;
  if (r.movidos === 0 && r.comErro === 0) {
    return ["Nenhum arquivo pendente no FTP", pastas].filter(Boolean).join("; ");
  }
  return [`${r.movidos} movido(s), ${r.comErro} com erro`, pastas].filter(Boolean).join(", ");
}

export function statusDaSincronizacao(
  processados: number,
  comErro: number,
): "ok" | "parcial" | "erro" {
  if (comErro === 0) return "ok";
  return processados > 0 ? "parcial" : "erro";
}
