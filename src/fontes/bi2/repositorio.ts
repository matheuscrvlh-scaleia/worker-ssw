import { type Transacao } from "@erp/db";
import { bi2Bruto, bi2Sincronizacoes, ctes } from "@erp/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

import { comoCte } from "../../infra";
import { exigirEmpresa } from "../comum/empresa";
import { type RepositorioBi2 } from "./job";

export function criarRepositorioBi2(
  tx: Transacao,
  empresaDoContexto: string | null,
): RepositorioBi2 {
  const empresa = () => exigirEmpresa(empresaDoContexto);
  return {
    ctesPorNumeros: async (numeros) => {
      if (numeros.length === 0) return [];
      const linhas = await tx
        .select()
        .from(ctes)
        .where(and(eq(ctes.empresaId, empresa()), inArray(ctes.numero, [...numeros])));
      return linhas.map(comoCte);
    },

    // Upsert por (empresa, número, relatório); payload igual não regrava (era o gatilho
    // _trg_bi2_raw_ignora_update_igual).
    gravarBruto: async (codigoRelatorio, dataAlvo, linhas, agora) => {
      if (linhas.length === 0) return;
      const ultimaPorNumero = new Map(linhas.map((l) => [l.numero, l.payload]));
      await tx
        .insert(bi2Bruto)
        .values(
          [...ultimaPorNumero].map(([numero, payload]) => ({
            empresaId: empresa(),
            numero,
            codigoRelatorio,
            dataAlvo,
            payload,
            atualizadoEm: agora,
          })),
        )
        .onConflictDoUpdate({
          target: [bi2Bruto.empresaId, bi2Bruto.numero, bi2Bruto.codigoRelatorio],
          set: {
            dataAlvo: sql`excluded.data_alvo`,
            payload: sql`excluded.payload`,
            atualizadoEm: sql`excluded.atualizado_em`,
          },
          setWhere: sql`(${bi2Bruto.payload}, ${bi2Bruto.dataAlvo}) is distinct from (excluded.payload, excluded.data_alvo)`,
        });
    },

    registrarSincronizacao: async (s) => {
      await tx.insert(bi2Sincronizacoes).values({ ...s, empresaId: empresa(), criados: 0 });
    },
  };
}
