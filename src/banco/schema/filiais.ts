/**
 * Agregado Filiais e Unidades.
 *
 * - `filiais`: catálogo de filiais do SSW (sigla), por empresa. `propria` define o universo das
 *   telas: CT-e cuja filial efetiva é própria aparece; o resto não.
 * - `filiais_apelidos`: cidade (normalizada) que o SSW escreve no complemento → sigla da filial.
 * - `unidades`: unidades operacionais da empresa (escopo de usuário, equipe, meta, anotação).
 *   Não é a mesma coisa que filial: hoje `unidades` tem 7 linhas e `filiais_ssw` 23.
 *
 * Origem: public.filiais_ssw, public.filial_alias, public.unidades.
 */
import { boolean, text } from "drizzle-orm/pg-core";

import { atualizadoEm, empresaId } from "./_comum";
import { erp } from "./base";

export const filiais = erp.table("filiais", {
  empresaId: empresaId(),
  sigla: text("sigla").notNull(),
  tipo: text("tipo").notNull(),
  nome: text("nome").notNull(),
  razaoSocial: text("razao_social"),
  cnpj: text("cnpj"),
  cidade: text("cidade"),
  uf: text("uf"),
  /**
   * Filial do universo da empresa. Marcada pela Plataforma; a ingestão do cadastro SSW não
   * altera.
   */
  propria: boolean("propria").notNull().default(false),
  atualizadoEm: atualizadoEm(),
});

export const filiaisApelidos = erp.table("filiais_apelidos", {
  empresaId: empresaId(),
  cidadeNormalizada: text("cidade_normalizada").notNull(),
  filial: text("filial").notNull(),
});
