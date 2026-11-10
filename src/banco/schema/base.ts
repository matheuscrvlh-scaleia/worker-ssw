import { pgSchema, timestamp } from "drizzle-orm/pg-core";

/** Schema do ERP SSW. O dono é o ERP (migrations em erp-ssw/packages/db); aqui só se lê e grava. */
export const erp = pgSchema("erp");

export const criadoEm = () =>
  timestamp("criado_em", { withTimezone: true, mode: "date" }).defaultNow().notNull();

export const atualizadoEm = () =>
  timestamp("atualizado_em", { withTimezone: true, mode: "date" }).defaultNow().notNull();
