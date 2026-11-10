/**
 * Agregado Ocorrências do CT-e.
 *
 * Um evento SSW (código 0–99) num instante. Chegam pelo 930 (FTP), pelo webhook SSW e pelas
 * aplicações de relatório. ~1,5 mi de linhas: é a maior tabela de domínio junto com `ctes`.
 *
 * Gravar/apagar uma ocorrência recalcula, na mesma transação, as colunas derivadas do CT-e
 * (ocorrência efetiva, cancelado no mesmo dia, embarque, emissão pela 80, status atual): antes
 * eram 6 gatilhos em `ocorrencias`.
 *
 * Origem: public.ocorrencias.
 */
import { boolean, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { criadoEm, empresaId } from "./_comum";
import { erp } from "./base";
import { responsavelOcorrencia } from "./codigos-ocorrencia";

export const ocorrencias = erp.table("ocorrencias", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  cteId: uuid("cte_id").notNull(),
  codigo: smallint("codigo").notNull(),
  descricao: text("descricao"),
  complemento: text("complemento"),
  dataHora: timestamp("data_hora", { withTimezone: true, mode: "date" }).notNull(),
  /** Filial onde a ocorrência foi lançada (sigla SSW). */
  filial: text("filial"),
  /** Protocolo do evento no webhook SSW: deduplica reentrega do mesmo evento. */
  protocoloSsw: text("protocolo_ssw"),
  /**
   * Canal de entrada (ex.: manual, webhook, relatorio_ssw, aplicacao_ssw, trackingdanfe).
   * Texto livre de propósito: o migrador preserva os valores atuais; a spec da ingestão fecha
   * a lista e aí vira check.
   */
  origem: text("origem").notNull().default("manual"),
  // calculada pelo backend: do catálogo (codigos_ocorrencia.responsavel) ao gravar; regravada em todas as ocorrências do código quando o catálogo muda. origem: fill_ocorrencia_penaliza / propagate_codigo_changes
  responsavel: responsavelOcorrencia("responsavel").notNull(),
  // calculada pelo backend: do catálogo (codigos_ocorrencia.penaliza), mesma regra de responsavel. origem: fill_ocorrencia_penaliza / propagate_codigo_changes
  penaliza: boolean("penaliza").notNull().default(false),
  // calculada pelo backend: dia (SP) de data_hora anterior à emissão do CT-e (ou trackingdanfe 400 dias antes da criação do CT-e) → não entra nas regras. origem: guard_data_ocorrencia
  quarentena: boolean("quarentena").notNull().default(false),
  criadoEm: criadoEm(),
});
