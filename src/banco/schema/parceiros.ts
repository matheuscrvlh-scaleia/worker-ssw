/**
 * Agregado Parceiros e Prazos configurados.
 *
 * - `parceiros`: transportadoras parceiras com prazo acordado (tela Prazo de parceiro).
 * - `prazos_configurados`: regra de prazo por unidade (horas), por parceiro (dias) ou por
 *   transbordo unidade→unidade (dias). Usada para calcular a previsão do CT-e.
 *
 * Não existe tabela de pagadores: pagador é atributo do CT-e (`ctes.pagador_cnpj/nome`) e a
 * lista de pagadores da tela é consulta sobre `ctes`.
 *
 * Origem: public.parceiros, public.prazos_configurados.
 */
import { boolean, integer, text, uuid } from "drizzle-orm/pg-core";

import { atualizadoEm, criadoEm, empresaId } from "./_comum";
import { erp } from "./base";

export const prazosConfigurados = erp.table("prazos_configurados", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  tipo: text("tipo", { enum: ["unidade", "parceiro", "transbordo"] }).notNull(),
  unidadeCodigo: text("unidade_codigo"),
  unidadeDestinoCodigo: text("unidade_destino_codigo"),
  parceiroCnpj: text("parceiro_cnpj"),
  parceiroNome: text("parceiro_nome"),
  prazoHoras: integer("prazo_horas"),
  prazoDias: integer("prazo_dias"),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});
