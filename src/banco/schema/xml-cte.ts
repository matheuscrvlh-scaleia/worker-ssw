/**
 * Agregado XML de CT-e (upload manual e pasta FTP de XML).
 *
 * - `xml_cte_arquivos`: arquivo (zip ou xml) recebido; o SHA-256 deduplica reenvio.
 * - `xml_cte_itens`: cada XML dentro do arquivo; o SHA-256 do XML com sucesso deduplica.
 * - `xml_cte_orfaos`: XML cujo CT-e ainda não existe; fica guardado para casar depois, até expirar.
 * - `xml_ftp_sincronizacoes`: log de cada rodada da sincronização da pasta FTP de XML.
 *
 * Retenção (job do worker):
 * - arquivos e itens: 180 dias pelo `criado_em` (itens vão junto, em cascata). Reenvio depois disso
 *   é reprocessado, e o processamento é idempotente (upsert pelo CT-e).
 * - órfãos: `casado` e `expirado` apagados 30 dias depois de `atualizado_em` (o XML é grande).
 * - sincronizações FTP: 90 dias.
 *
 * Origem: public.xml_cte_arquivos_processados, public.xml_cte_itens_processados,
 * public.xml_cte_orfaos, public.ftp_xml_sync_log.
 */
import { sql } from "drizzle-orm";
import { integer, jsonb, text, uuid } from "drizzle-orm/pg-core";

import { atualizadoEm, criadoEm, empresaId, instante } from "./_comum";
import { erp } from "./base";

export const xmlCteArquivos = erp.table("xml_cte_arquivos", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  nomeArquivo: text("nome_arquivo").notNull(),
  sha256: text("sha256").notNull(),
  tipo: text("tipo", { enum: ["zip", "xml"] }).notNull(),
  status: text("status", { enum: ["sucesso", "erro", "parcial", "duplicado"] }).notNull(),
  erroMensagem: text("erro_mensagem"),
  ctesProcessados: integer("ctes_processados").notNull().default(0),
  cancelamentos: integer("cancelamentos").notNull().default(0),
  xmlsPulados: integer("xmls_pulados").notNull().default(0),
  criadoEm: criadoEm(),
});

export const xmlCteItens = erp.table("xml_cte_itens", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  arquivoId: uuid("arquivo_id"),
  sha256Xml: text("sha256_xml").notNull(),
  nomeXml: text("nome_xml").notNull(),
  tipo: text("tipo", { enum: ["cte", "can", "unknown"] }).notNull(),
  status: text("status", { enum: ["sucesso", "erro", "orfao"] }).notNull(),
  /** Número do CTRC (dígitos) lido do XML. */
  numeroCte: text("numero_cte"),
  chaveCte: text("chave_cte"),
  erroMensagem: text("erro_mensagem"),
  criadoEm: criadoEm(),
});

export const xmlCteOrfaos = erp.table("xml_cte_orfaos", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  sha256Xml: text("sha256_xml").notNull(),
  nomeXml: text("nome_xml").notNull(),
  tipo: text("tipo", { enum: ["cte", "can"] }).notNull(),
  chaveCte: text("chave_cte"),
  numeroCte: text("numero_cte"),
  xmlConteudo: text("xml_conteudo").notNull(),
  status: text("status", { enum: ["pendente", "casado", "expirado"] })
    .notNull()
    .default("pendente"),
  tentativas: integer("tentativas").notNull().default(0),
  ultimaTentativa: instante("ultima_tentativa"),
  ultimoErro: text("ultimo_erro"),
  casadoEm: instante("casado_em"),
  /** Gravado pelo backend no cadastro: criado_em + 5 dias. */
  expiraEm: instante("expira_em").notNull(),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const xmlFtpSincronizacoes = erp.table("xml_ftp_sincronizacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  executadoEm: instante("executado_em").notNull().defaultNow(),
  finalizadoEm: instante("finalizado_em"),
  status: text("status", { enum: ["ok", "parcial", "erro", "pausado"] }).notNull(),
  disparadoPor: text("disparado_por", { enum: ["agendamento", "manual"] })
    .notNull()
    .default("agendamento"),
  arquivosProcessados: integer("arquivos_processados").notNull().default(0),
  arquivosRemovidos: integer("arquivos_removidos").notNull().default(0),
  arquivosMovidos: integer("arquivos_movidos").notNull().default(0),
  pastasLimpas: integer("pastas_limpas").notNull().default(0),
  arquivosComErro: integer("arquivos_com_erro").notNull().default(0),
  ctesProcessados: integer("ctes_processados").notNull().default(0),
  duracaoMs: integer("duracao_ms").notNull().default(0),
  mensagem: text("mensagem"),
  erros: jsonb("erros")
    .notNull()
    .default(sql`'[]'::jsonb`),
});
