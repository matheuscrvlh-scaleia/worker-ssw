/**
 * Agregado Catálogo de códigos de ocorrência (por empresa).
 *
 * Código SSW de 0 a 99 com a classificação que as telas usam (responsável, penaliza, tipo e
 * processo SSW). A empresa nova recebe uma cópia do catálogo da empresa modelo (antes era o
 * gatilho `_trg_empresas_semear`; agora é o caso de uso de criar empresa).
 *
 * Origem: public.codigos_ocorrencia.
 */
import { boolean, char, smallint, text, uuid } from "drizzle-orm/pg-core";

import { atualizadoEm, empresaId } from "./_comum";
import { erp } from "./base";

export const responsavelOcorrencia = erp.enum("responsavel_ocorrencia", [
  "FR",
  "transportador",
  "destinatario",
  "cliente",
  "sistema",
  "outro",
]);

export const tipoSsw = erp.enum("tipo_ssw", [
  "ENTREGA",
  "PRE_ENTREGA",
  "INFORMATIVA",
  "PENDENCIA_CLIENTE",
  "PENDENCIA_TRANSPORTADORA",
  "BAIXA",
]);

export const processoSsw = erp.enum("processo_ssw", [
  "ENTREGA",
  "DEVOLUCAO",
  "REENTREGA",
  "AGENDAMENTO",
  "COLETA",
  "BALSA",
  "OPERACIONAL",
  "GERAL",
  "FINALIZADORA",
  "INDENIZACAO",
]);

export const codigosOcorrencia = erp.table("codigos_ocorrencia", {
  empresaId: empresaId(),
  codigo: smallint("codigo").notNull(),
  descricao: text("descricao").notNull(),
  tipoSsw: tipoSsw("tipo_ssw"),
  processoSsw: processoSsw("processo_ssw"),
  /** true = `tipo_ssw` foi definido à mão; a sincronização do catálogo SSW não sobrescreve. */
  tipoSswManual: boolean("tipo_ssw_manual").notNull().default(false),
  // calculada pelo backend: derivada de tipo_ssw/processo_ssw ao cadastrar (PENDENCIA_TRANSPORTADORA → FR; PENDENCIA_CLIENTE em ENTREGA/REENTREGA → destinatario, senão cliente; demais → sistema). origem: codigos_derivar_responsavel
  responsavel: responsavelOcorrencia("responsavel").notNull(),
  // calculada pelo backend: F/D/C/S conforme o responsável derivado. origem: codigos_derivar_responsavel
  letraResponsavel: char("letra_responsavel", { length: 1 }),
  // calculada pelo backend: true só para PENDENCIA_TRANSPORTADORA ao cadastrar; depois editável na tela de códigos. origem: codigos_derivar_responsavel
  penaliza: boolean("penaliza").notNull().default(false),
  ativo: boolean("ativo").notNull().default(true),
  pendenteClassificacao: boolean("pendente_classificacao").notNull().default(false),
  /** Código de pendência acompanhado na tela de Ocorrências (painel de pendências). */
  pendenciaAcompanhada: boolean("pendencia_acompanhada").notNull().default(false),
  notas: text("notas"),
  atualizadoPor: uuid("atualizado_por"),
  atualizadoEm: atualizadoEm(),
});
