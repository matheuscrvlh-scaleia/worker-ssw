import { bigint, boolean, integer, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { atualizadoEm, criadoEm, erp } from "./base";

export const STATUS_EMPRESA = ["implantacao", "ativa", "suspensa", "encerrada"] as const;

/** Empresa (tenant) e a marca dela (menu, título da aba, exportações). */
export const empresas = erp.table("empresas", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nome: text("nome").notNull(),
  nomeCurto: text("nome_curto").notNull(),
  razaoSocial: text("razao_social"),
  cnpj: text("cnpj"),
  /** Domínio da empresa no SSW (ex.: FRT). */
  dominioSsw: text("dominio_ssw"),
  /** Chave do logo no armazenamento S3; a URL pública é montada pela API. */
  logoCaminho: text("logo_caminho"),
  corPrimaria: text("cor_primaria").notNull().default("#212a63"),
  corDestaque: text("cor_destaque").notNull().default("#c0392b"),
  slogan: text("slogan"),
  fuso: text("fuso").notNull().default("America/Sao_Paulo"),
  status: text("status", { enum: STATUS_EMPRESA }).notNull().default("implantacao"),
  criadoEm: criadoEm(),
  criadoPor: uuid("criado_por"),
  atualizadoEm: atualizadoEm(),
  atualizadoPor: uuid("atualizado_por"),
});

export const TIPOS_INTEGRACAO = [
  "sftp",
  "ssw_api",
  "ssw_bi2",
  "ssw_webhook",
  "ahgora",
  "xml_cte",
  "ingestao_publica",
] as const;

/**
 * Integração por empresa. O segredo (senha/token) fica cifrado com AES-256-GCM pela aplicação
 * (`segredos.ts`); `segredo_versao_chave` diz com qual chave mestra, para permitir rotação.
 */
export const empresaIntegracoes = erp.table("empresa_integracoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id").notNull(),
  tipo: text("tipo", { enum: TIPOS_INTEGRACAO }).notNull(),
  ativo: boolean("ativo").notNull().default(false),
  parametros: jsonb("parametros").$type<Record<string, unknown>>().notNull().default({}),
  segredoCifrado: text("segredo_cifrado"),
  segredoVersaoChave: integer("segredo_versao_chave"),
  segredoDefinidoEm: timestamp("segredo_definido_em", { withTimezone: true, mode: "date" }),
  /**
   * Segredo trocado por último (só o do webhook SSW), cifrado com o mesmo contexto: o
   * reprocesso de "token incorreto" aceita eventos assinados com ele.
   */
  segredoAnteriorCifrado: text("segredo_anterior_cifrado"),
  segredoAnteriorVersaoChave: integer("segredo_anterior_versao_chave"),
  ultimoTesteEm: timestamp("ultimo_teste_em", { withTimezone: true, mode: "date" }),
  ultimoTesteOk: boolean("ultimo_teste_ok"),
  ultimoTesteMsg: text("ultimo_teste_msg"),
  atualizadoEm: atualizadoEm(),
  atualizadoPor: uuid("atualizado_por"),
});

/** Configuração por empresa; `empresa_id` nulo = valor da plataforma (padrão de todas). */
export const configuracoes = erp.table("configuracoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: uuid("empresa_id"),
  chave: text("chave").notNull(),
  valor: text("valor").notNull(),
  descricao: text("descricao").notNull(),
  grupo: text("grupo").notNull(),
  atualizadoEm: atualizadoEm(),
  atualizadoPor: uuid("atualizado_por"),
});

export const TIPOS_ATOR = ["usuario", "plataforma", "sistema", "integracao"] as const;

/**
 * Auditoria (quem mudou o quê), gravada pelo caso de uso na mesma transação da mudança.
 * `empresa_id` nulo = ação fora de empresa (Plataforma ou a própria conta do usuário).
 * O app só insere e lê: sem política de UPDATE/DELETE, ninguém altera o histórico.
 */
export const auditoria = erp.table("auditoria", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  empresaId: uuid("empresa_id"),
  atorId: uuid("ator_id"),
  atorEmail: text("ator_email"),
  atorTipo: text("ator_tipo", { enum: TIPOS_ATOR }).notNull(),
  acao: text("acao").notNull(),
  entidade: text("entidade").notNull(),
  entidadeId: text("entidade_id"),
  resumo: text("resumo"),
  antes: jsonb("antes").$type<Record<string, unknown>>(),
  depois: jsonb("depois").$type<Record<string, unknown>>(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  criadoEm: criadoEm(),
});
