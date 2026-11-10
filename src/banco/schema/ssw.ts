/**
 * Agregado Integração SSW (webhook e WebAPI).
 *
 * - `ssw_webhook_eventos`: cada chamada recebida em `/api/public/ssw-ocorrencias` de uma empresa
 *   identificada (autenticada ou rejeitada por regra). O payload da autenticada fica para o
 *   reprocessamento manual da tela SSW Diagnóstico; a recusada guarda só metadados, salvo a
 *   quarentena de "token incorreto" (ADR 0009). Chamada sem empresa identificável não entra aqui:
 *   vai só para o log estruturado da API.
 * - `ssw_sincronizacoes`: log das execuções contra a WebAPI do SSW; a tela Ingestão lê a última
 *   falha de autenticação daqui.
 *
 * Credenciais e configuração do SSW (token, usuário, senha, segredo do webhook, CNPJs aceitos,
 * última verificação) NÃO são domínio: vão para `empresa_integracoes` da fundação.
 *
 * Retenção (job do worker): webhook 90 dias por `recebido_em`; sincronizações 90 dias por
 * `executado_em`.
 *
 * Origem: public.ssw_webhook_eventos, public.sync_log.
 */
import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, smallint, text, uuid } from "drizzle-orm/pg-core";

import { empresaId, instante } from "./_comum";
import { erp } from "./base";

export const sswWebhookEventos = erp.table("ssw_webhook_eventos", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  recebidoEm: instante("recebido_em").notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  autenticado: boolean("autenticado").notNull().default(false),
  motivoRejeicao: text("motivo_rejeicao"),
  statusHttp: smallint("status_http").notNull(),
  payloadBruto: jsonb("payload_bruto"),
  /**
   * SHA-256 (hex) de cada candidato a segredo da credencial recebida; nunca o token em si. O
   * reprocesso de "token incorreto" só aceita o evento se o resumo do segredo atual ou do
   * anterior estiver aqui.
   */
  tokenSha256: text("token_sha256").array(),
  cteId: uuid("cte_id"),
  ocorrenciaId: uuid("ocorrencia_id"),
  erroProcessamento: text("erro_processamento"),
});

export const sswSincronizacoes = erp.table("ssw_sincronizacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  modo: text("modo", { enum: ["historico", "delta"] }).notNull(),
  status: text("status", { enum: ["ok", "erro", "parcial", "em_andamento"] }).notNull(),
  disparadoPor: text("disparado_por", { enum: ["agendamento", "manual", "api"] })
    .notNull()
    .default("agendamento"),
  executadoEm: instante("executado_em").notNull().defaultNow(),
  finalizadoEm: instante("finalizado_em"),
  ctesProcessados: integer("ctes_processados").notNull().default(0),
  ocorrenciasProcessadas: integer("ocorrencias_processadas").notNull().default(0),
  duracaoMs: integer("duracao_ms").notNull().default(0),
  mensagem: text("mensagem"),
  /** Mensagens de erro da execução (lista de texto). */
  erros: jsonb("erros")
    .notNull()
    .default(sql`'[]'::jsonb`),
});
