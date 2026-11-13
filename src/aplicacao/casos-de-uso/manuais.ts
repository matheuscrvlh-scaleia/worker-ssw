/**
 * Operações manuais da tela Admin › Importação SSW, pedidas pelo ERP no HTTP interno (ADR 0012).
 * Movido de erp-ssw/apps/api/src/modulos/ingestao/casos-de-uso.ts: a regra é a mesma; muda só que
 * a empresa vem do caminho e quem pediu fica na auditoria do ERP.
 */
import { ErroDeNegocio } from "@erp/domain/errors";
import { JOBS_DE_INGESTAO } from "@erp/shared/ingestion";

import {
  type AplicacaoValidada,
  type PedidoDeXml,
  type RelatorioValidado,
  type ResultadoDaAplicacao,
  type ResultadoDoXml,
  type SituacaoDoFtp,
} from "../../contrato-interno";
import { aplicarBloco } from "./aplicar";
import {
  aplicar036,
  type DependenciasDoCiclo,
  descartarCiclo,
  LEASE_DO_CICLO_MS,
  retomarCiclo,
  travaDoCiclo,
} from "./ciclo";
import { travaDoFtp } from "./ftp";
import { type Progressos } from "./portas";
import { importarRelatorioManual } from "./receber";
import { importarArquivoXml } from "./xml";

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Horário do FTP em português (Q37: o de produção, igual para todas as empresas). */
const CRON_DO_FTP = JOBS_DE_INGESTAO.find((j) => j.job === "sincronizar-ftp")?.cron ?? "";
const DESCRICAO_DA_AGENDA = `A cada minuto, exceto :00 e :30 (${CRON_DO_FTP} UTC)`;

/** Motivo gravado no ciclo quando o ERP não manda um. */
const MOTIVO_PADRAO_DO_DESCARTE = "Descartado pela tela, sem motivo informado";

/** Bytes de um base64, com ou sem o prefixo `data:...;base64,`. */
export function bytesDoBase64(conteudo: string): Uint8Array {
  const texto = conteudo.startsWith("data:") ? (conteudo.split(",", 2)[1] ?? "") : conteudo;
  return new Uint8Array(Buffer.from(texto, "base64"));
}

/**
 * Aplicação manual de um bloco. A de verdade não roda junto com o ciclo automático (mesma trava);
 * o romaneio pelo 036 só no último bloco, e a manual não roda as partes do 455 (spec §3.13).
 */
export async function aplicarManualmente(
  deps: DependenciasDoCiclo,
  pedido: AplicacaoValidada,
): Promise<ResultadoDaAplicacao> {
  const { simular: dryRun, limite, offset } = pedido;
  const trava = travaDoCiclo(deps.empresaId);
  const token = dryRun ? null : await deps.travas.adquirir(trava, LEASE_DO_CICLO_MS);
  if (!dryRun && token === null) {
    throw new ErroDeNegocio(
      "CONFLITO",
      "A aplicação automática está rodando agora. Tente de novo em instantes.",
    );
  }
  try {
    const r = await aplicarBloco(deps, { dryRun, limite, offset, usuarioId: null });
    const temMais = dryRun ? r.processados === limite : r.pendentes > 0 && r.processados > 0;
    const romaneio036 = temMais ? null : (await aplicar036(deps, dryRun)).alterados;
    return { ...r, temMais, romaneio036 };
  } finally {
    if (token) await deps.travas.liberar(trava, token);
  }
}

/** Situação da sincronização do FTP: pausa, agenda, trava e progresso (Redis). */
export async function lerFtp(
  deps: DependenciasDoCiclo,
  progressos: Progressos,
): Promise<SituacaoDoFtp> {
  const config = await deps.executar((r) => r.configuracoes(["ftp_sync_ativo"]));
  const p = await progressos.ler(deps.empresaId);
  return {
    ativo: config.get("ftp_sync_ativo") !== "false",
    agenda: DESCRICAO_DA_AGENDA,
    travaAtiva: await deps.travas.ativa(travaDoFtp(deps.empresaId)),
    progresso: p && {
      ...p,
      iniciadoEm: iso(p.iniciadoEm),
      heartbeatEm: iso(p.heartbeatEm),
      finalizadoEm: iso(p.finalizadoEm),
    },
  };
}

export async function pausarOuRetomarFtp(deps: DependenciasDoCiclo, ativo: boolean) {
  await deps.executar(async (r) => {
    await r.gravarConfiguracao("ftp_sync_ativo", String(ativo));
    await r.auditar({
      acao: ativo ? "retomar" : "pausar",
      entidade: "configuracoes",
      entidadeId: "ftp_sync_ativo",
      resumo: ativo ? "Sincronização do FTP retomada" : "Sincronização do FTP pausada",
      depois: { ativo },
    });
  });
}

export async function liberarTravaDoFtp(deps: DependenciasDoCiclo, progressos: Progressos) {
  await deps.travas.forcarLiberacao(travaDoFtp(deps.empresaId));
  await progressos.limpar(deps.empresaId);
  await deps.executar((r) =>
    r.auditar({
      acao: "liberar_trava",
      entidade: "empresa_integracoes",
      entidadeId: "sftp",
      resumo: "Trava do FTP liberada à mão",
      depois: {},
    }),
  );
}

/** As operações da tela por empresa, como o HTTP interno as chama. */
export interface OperacoesManuais {
  retomarCiclo(empresaId: string, chave: string): ReturnType<typeof retomarCiclo>;
  descartarCiclo(
    empresaId: string,
    chave: string,
    motivo: string | undefined,
  ): Promise<{ cicloChave: string; totalRemovido: number }>;
  importarRelatorio(
    empresaId: string,
    pedido: RelatorioValidado,
  ): Promise<{ loteId: string; gravados: number; erros: number }>;
  aplicar(empresaId: string, pedido: AplicacaoValidada): Promise<ResultadoDaAplicacao>;
  lerFtp(empresaId: string): Promise<SituacaoDoFtp>;
  ativarFtp(empresaId: string, ativo: boolean): Promise<void>;
  liberarTravaDoFtp(empresaId: string): Promise<void>;
  importarXml(empresaId: string, pedido: PedidoDeXml): Promise<ResultadoDoXml>;
}

export function criarOperacoesManuais(s: {
  /** Dependências da ingestão no contexto (RLS) da empresa. */
  deps: (empresaId: string) => DependenciasDoCiclo;
  progressos: Progressos;
}): OperacoesManuais {
  return {
    retomarCiclo: (empresaId, chave) => retomarCiclo(s.deps(empresaId), chave),
    async descartarCiclo(empresaId, chave, motivo) {
      const r = await descartarCiclo(s.deps(empresaId), chave, motivo ?? MOTIVO_PADRAO_DO_DESCARTE);
      return { cicloChave: r.cicloChave, totalRemovido: r.totalRemovido };
    },
    importarRelatorio: (empresaId, p) =>
      importarRelatorioManual(s.deps(empresaId).executar, {
        relatorio: p.relatorio,
        conteudo: new TextDecoder("utf-8").decode(bytesDoBase64(p.conteudoBase64)),
        nome: p.nomeArquivo,
        aceitarDivergencia: p.aceitarDivergencia,
      }),
    aplicar: (empresaId, pedido) => aplicarManualmente(s.deps(empresaId), pedido),
    lerFtp: (empresaId) => lerFtp(s.deps(empresaId), s.progressos),
    ativarFtp: (empresaId, ativo) => pausarOuRetomarFtp(s.deps(empresaId), ativo),
    liberarTravaDoFtp: (empresaId) => liberarTravaDoFtp(s.deps(empresaId), s.progressos),
    importarXml(empresaId, { nomeArquivo, conteudoBase64 }) {
      const deps = s.deps(empresaId);
      return importarArquivoXml(
        deps.executar,
        { nome: nomeArquivo, bytes: bytesDoBase64(conteudoBase64) },
        deps.agora(),
      );
    },
  };
}
