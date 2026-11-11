import { type Transacao } from "@erp/db";
import { empresaIntegracoes, empresas } from "@erp/db/schema";
import { STATUS_EM_OPERACAO } from "@erp/domain/companies";
import { and, asc, eq, inArray } from "drizzle-orm";

import { type RepositorioAgendamentos } from "./agendamentos";

export function criarRepositorioAgendamentos(tx: Transacao): RepositorioAgendamentos {
  return {
    empresasAtivas: () =>
      tx
        .select({ id: empresas.id, fuso: empresas.fuso })
        .from(empresas)
        .where(inArray(empresas.status, [...STATUS_EM_OPERACAO])),
    empresasComIntegracao: (tipos) =>
      tx
        .selectDistinct({ id: empresas.id, criadoEm: empresas.criadoEm })
        .from(empresas)
        .innerJoin(empresaIntegracoes, eq(empresaIntegracoes.empresaId, empresas.id))
        .where(
          and(
            inArray(empresas.status, [...STATUS_EM_OPERACAO]),
            inArray(empresaIntegracoes.tipo, [...tipos]),
            eq(empresaIntegracoes.ativo, true),
          ),
        )
        .orderBy(asc(empresas.criadoEm), asc(empresas.id)),
  };
}
