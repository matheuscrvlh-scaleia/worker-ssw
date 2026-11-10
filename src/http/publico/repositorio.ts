import { type Transacao } from "@erp/db";
import { empresaIntegracoes, empresas } from "@erp/db/schema";
import { type SegredoCifrado } from "@erp/db/segredos";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { type EmpresaParaIngestao } from "../../aplicacao/casos-de-uso";

/** Leituras da Plataforma usadas pelas rotas públicas da ingestão. */
export function criarRepositorioDaIngestaoPublica(tx: Transacao) {
  return {
    empresasParaIngestao: (): Promise<EmpresaParaIngestao[]> =>
      tx
        .select({
          id: empresas.id,
          slug: empresas.slug,
          nome: empresas.nome,
          status: empresas.status,
          integracoesAtivas: sql<
            string[]
          >`coalesce(array_agg(${empresaIntegracoes.tipo}) filter (where ${empresaIntegracoes.tipo} is not null), '{}')`,
        })
        .from(empresas)
        .leftJoin(
          empresaIntegracoes,
          and(eq(empresaIntegracoes.empresaId, empresas.id), eq(empresaIntegracoes.ativo, true)),
        )
        .groupBy(empresas.id),
    /** Segredo cifrado da integração `ingestao_publica` ligada de cada empresa. */
    async segredosDaIngestao(): Promise<{ empresaId: string; segredo: SegredoCifrado }[]> {
      const linhas = await tx
        .select({
          empresaId: empresaIntegracoes.empresaId,
          cifrado: empresaIntegracoes.segredoCifrado,
          versaoChave: empresaIntegracoes.segredoVersaoChave,
        })
        .from(empresaIntegracoes)
        .where(
          and(
            eq(empresaIntegracoes.tipo, "ingestao_publica"),
            eq(empresaIntegracoes.ativo, true),
            isNotNull(empresaIntegracoes.segredoCifrado),
          ),
        );
      return linhas.flatMap(({ empresaId, cifrado, versaoChave }) =>
        cifrado === null || versaoChave === null
          ? []
          : [{ empresaId, segredo: { cifrado, versaoChave } }],
      );
    },
  };
}
