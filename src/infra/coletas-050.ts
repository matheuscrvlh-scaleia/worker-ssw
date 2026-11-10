/**
 * Gravação do relatório 050 em `coletas` (tela de Coletas na API e 050 do FTP no worker), presa a
 * uma transação no contexto da empresa.
 */
import { type Transacao } from "@erp/db";
import { coletas } from "@erp/db/schema";
import { type RepositorioGravacao050 } from "@erp/dominio/coletas/gravacao-050";
import { and, eq, getTableColumns, inArray, sql } from "drizzle-orm";

const instante = (iso: string | null) => (iso === null ? null : new Date(iso));
const comoNumeric = (valor: number | null) => (valor === null ? null : String(valor));

/** Na coleta que já existe, a gravação do 050 substitui todas as colunas menos a chave. */
const SUBSTITUIR_TUDO = Object.fromEntries(
  Object.entries(getTableColumns(coletas))
    .filter(([chave]) => !["empresaId", "unidade", "numero"].includes(chave))
    .map(([chave, coluna]) => [chave, sql.raw(`excluded."${coluna.name}"`)]),
);

export function criarRepositorioGravacao050(tx: Transacao): RepositorioGravacao050 {
  return {
    jaGravadas: async (empresaId, chaves) => {
      if (chaves.length === 0) return [];
      const linhas = await tx
        .select({
          unidade: coletas.unidade,
          numero: coletas.numero,
          relatorioEmitidoEm: coletas.relatorioEmitidoEm,
          prejudicadaHorario: coletas.prejudicadaHorario,
          cteSigla: coletas.cteSigla,
          cteNumero: coletas.cteNumero,
          romaneio: coletas.romaneio,
        })
        .from(coletas)
        .where(
          and(
            eq(coletas.empresaId, empresaId),
            inArray(coletas.numero, [...new Set(chaves.map((c) => c.numero))]),
            inArray(coletas.unidade, [...new Set(chaves.map((c) => c.unidade))]),
          ),
        );
      const pedidas = new Set(chaves.map((c) => `${c.unidade}|${c.numero}`));
      return linhas.filter((l) => pedidas.has(`${l.unidade}|${l.numero}`));
    },

    gravar: async (empresaId, novas, agora) => {
      if (novas.length === 0) return;
      await tx
        .insert(coletas)
        .values(
          novas.map((c) => ({
            empresaId,
            unidade: c.unidade,
            numero: c.numero,
            tipo: c.tipo,
            remetenteCnpj: c.remetenteCnpj,
            remetenteNome: c.remetenteNome,
            remetenteCidade: c.remetenteCidade,
            setor: c.setor,
            destinatarioCnpj: c.destinatarioCnpj,
            destinatarioNome: c.destinatarioNome,
            destinoCidade: c.destinoCidade,
            solicitante: c.solicitante,
            motorista: c.motorista,
            placa: c.placa,
            situacao: c.situacao,
            etapa: c.etapa,
            situacaoEm: instante(c.situacaoEm),
            limiteEm: instante(c.limiteEm),
            limiteInicial: c.limiteInicial,
            cadastradaEm: instante(c.cadastradaEm),
            cadastradaPor: c.cadastradaPor,
            diaCadastro: c.diaCadastro,
            comandadaEm: instante(c.comandadaEm),
            coletadaEm: instante(c.coletadaEm),
            canceladaEm: instante(c.canceladaEm),
            valorMercadoria: comoNumeric(c.valorMercadoria),
            volumes: c.volumes === null ? null : Math.round(c.volumes),
            pesoKg: comoNumeric(c.pesoKg),
            mercadoria: c.mercadoria,
            tipoFrete: c.tipoFrete,
            notasFiscais: c.notasFiscais,
            observacao: c.observacao,
            cteSigla: c.cteSigla,
            cteNumero: c.cteNumero,
            romaneio: c.romaneio,
            prejudicadaHorario: c.prejudicadaHorario,
            historico: c.historico,
            relatorioEmitidoEm: c.relatorioEmitidoEm,
            arquivoOrigem: c.arquivoOrigem,
            atualizadoEm: agora,
          })),
        )
        .onConflictDoUpdate({
          target: [coletas.empresaId, coletas.unidade, coletas.numero],
          set: SUBSTITUIR_TUDO,
        });
    },
  };
}
