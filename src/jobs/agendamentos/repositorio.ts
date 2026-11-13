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
    empresasComIntegracao: (tipo) =>
      tx
        .select({ id: empresas.id })
        .from(empresas)
        .innerJoin(empresaIntegracoes, eq(empresaIntegracoes.empresaId, empresas.id))
        .where(
          and(
            inArray(empresas.status, [...STATUS_EM_OPERACAO]),
            eq(empresaIntegracoes.tipo, tipo),
            eq(empresaIntegracoes.ativo, true),
          ),
        )
        .orderBy(asc(empresas.criadoEm), asc(empresas.id)),
  };
}
