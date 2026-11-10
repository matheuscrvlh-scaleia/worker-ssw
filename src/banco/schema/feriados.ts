/**
 * Agregado Calendário: feriados.
 *
 * `empresa_id` nulo = feriado nacional, que vale para todas as empresas. Preenchido = feriado só
 * daquela empresa (municipal/estadual ou nacional cadastrado à mão por ela).
 *
 * RLS: a empresa lê os nacionais e os dela, e só grava os dela. Nacional só é gravado em sessão
 * de Plataforma (geração automática anual) ou pela migration/seed. Segue o `public.feriados`
 * atual coluna a coluna.
 *
 * Origem: public.feriados.
 */
import { boolean, date, text, uuid } from "drizzle-orm/pg-core";

import { atualizadoEm, criadoEm } from "./_comum";
import { erp } from "./base";

export const tipoFeriado = erp.enum("tipo_feriado", ["nacional", "municipal", "estadual"]);

export const feriados = erp.table("feriados", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Nulo = feriado nacional (todas as empresas). */
  empresaId: uuid("empresa_id"),
  data: date("data", { mode: "string" }).notNull(),
  tipo: tipoFeriado("tipo").notNull(),
  cidade: text("cidade"),
  uf: text("uf"),
  descricao: text("descricao").notNull(),
  geradoAutomaticamente: boolean("gerado_automaticamente").notNull().default(false),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});
