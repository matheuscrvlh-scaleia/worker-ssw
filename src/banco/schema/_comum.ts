/** Colunas repetidas (cópia de erp-ssw/packages/db/src/schema/dominio/_comum.ts, sem a FK). */
import { timestamp, uuid } from "drizzle-orm/pg-core";

export { atualizadoEm, criadoEm } from "./base";

export const empresaId = () => uuid("empresa_id").notNull();

/** `timestamptz` anulável, no modo `Date`. */
export const instante = (nome: string) => timestamp(nome, { withTimezone: true, mode: "date" });
