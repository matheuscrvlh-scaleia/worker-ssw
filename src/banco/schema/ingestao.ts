/**
 * Agregado Ingestão dos relatórios SSW (FTP → worker).
 *
 * Fluxo: o worker vê o arquivo no FTP (`ingestao_arquivos`), agrupa por ciclo
 * (`ingestao_ciclos`), lê as linhas (`ingestao_linhas`, deduplicadas por hash), aplica em `ctes`/
 * `ocorrencias`/`coletas` e nas projeções, e registra a aplicação (`ingestao_aplicacoes`).
 * Linha que não parseia vai para `ingestao_erros`.
 *
 * As antigas `staging_038/455/455_csv/930/306/036` (≈ 4 GB, uma tabela larga por relatório) viram
 * uma tabela só, `ingestao_linhas`, com a linha já parseada em `dados` (jsonb, validado por zod no
 * worker) e só as colunas de que a deduplicação e o reprocessamento precisam. Ela não é fonte
 * da verdade: depois de aplicada, a verdade está em `ctes`, `ocorrencias` e nas projeções.
 *
 * Retenção (job diário do worker):
 * - `ingestao_linhas`: 60 dias depois de `aplicado_em` (janela de reprocessamento e de
 *   auditoria "de onde veio este valor"). Linha não aplicada não expira. A dedupe por hash só
 *   vale dentro da janela; fora dela, o reenvio de arquivo antigo é barrado pelo SHA-256 em
 *   `ingestao_arquivos` e, se passar, a aplicação é idempotente.
 * - `ingestao_erros`: 30 dias.
 * - `ingestao_arquivos`, `ingestao_ciclos`, `ingestao_aplicacoes`: 180 dias.
 * - Retenção nunca apaga projeção (ver projecoes.ts).
 *
 * Fila de aplicação (`ssw_aplicacao_fila`, `ssw_fila_controle`), lease de job (`job_lease`) e
 * progresso da sincronização FTP (`ftp_sync_progresso`) viram estado do BullMQ/Redis no worker.
 *
 * Origem: public.ssw_relatorio_arquivos, public.ssw_ciclo_importacao, public.ssw_relatorio_tipos,
 * public.staging_* (6 tabelas), public.staging_*_erros_parsing (5), public.ssw_aplicacao_log.
 */
import { sql } from "drizzle-orm";
import { bigint, boolean, integer, jsonb, text, uuid } from "drizzle-orm/pg-core";

import { atualizadoEm, criadoEm, empresaId, instante } from "./_comum";
import { erp } from "./base";

/**
 * Relatórios SSW esperados no ciclo, por empresa (o que a tela Pipeline mostra como faltante).
 * Prefixo do arquivo e parser são constantes do código do worker, não dado.
 */
export const ingestaoRelatoriosEsperados = erp.table("ingestao_relatorios_esperados", {
  empresaId: empresaId(),
  /** Código do relatório SSW (ex.: 036, 038, 050, 306, 455, 930). */
  relatorio: text("relatorio").notNull(),
  descricao: text("descricao").notNull().default(""),
  porUnidade: boolean("por_unidade").notNull().default(false),
  unidadesEsperadas: text("unidades_esperadas")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  obrigatorioNoCiclo: boolean("obrigatorio_no_ciclo").notNull().default(true),
  ativo: boolean("ativo").notNull().default(true),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const ingestaoCiclos = erp.table("ingestao_ciclos", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  /** Identificador do ciclo de arquivos do FTP (ex.: data + janela). */
  cicloChave: text("ciclo_chave").notNull(),
  /** aberto, aguardando, aplicando, aplicado, erro... (lista fechada pela spec da ingestão). */
  status: text("status").notNull().default("aberto"),
  motivo: text("motivo"),
  /** Relatórios/unidades que faltaram para fechar o ciclo. */
  faltantes: jsonb("faltantes")
    .notNull()
    .default(sql`'[]'::jsonb`),
  totais: jsonb("totais")
    .notNull()
    .default(sql`'{}'::jsonb`),
  arquivosImportados: integer("arquivos_importados").notNull().default(0),
  linhasImportadas: integer("linhas_importadas").notNull().default(0),
  primeiroArquivoEm: instante("primeiro_arquivo_em").notNull().defaultNow(),
  ultimoArquivoEm: instante("ultimo_arquivo_em").notNull().defaultNow(),
  fechadoEm: instante("fechado_em"),
  aplicadoEm: instante("aplicado_em"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const ingestaoArquivos = erp.table("ingestao_arquivos", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  nomeArquivo: text("nome_arquivo").notNull(),
  cicloChave: text("ciclo_chave"),
  relatorio: text("relatorio"),
  /** Sigla da unidade quando o relatório é por unidade. */
  unidade: text("unidade"),
  tamanho: bigint("tamanho", { mode: "number" }).notNull().default(0),
  /** mtime do arquivo no FTP (epoch ms). */
  mtime: bigint("mtime", { mode: "number" }).notNull().default(0),
  sha256: text("sha256"),
  /** observado, importando, importado, ignorado, erro. */
  status: text("status").notNull().default("observado"),
  linhas: integer("linhas").notNull().default(0),
  mensagem: text("mensagem"),
  loteId: uuid("lote_id"),
  vistoEm: instante("visto_em").notNull().defaultNow(),
  importadoEm: instante("importado_em"),
  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

/**
 * Uma linha de relatório já parseada. Chave de dedupe: empresa + relatório + hash da linha
 * normalizada (o hash é calculado pelo worker, como era `staging_*_set_dado_hash`).
 */
export const ingestaoLinhas = erp.table("ingestao_linhas", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  empresaId: empresaId(),
  relatorio: text("relatorio").notNull(),
  loteId: uuid("lote_id").notNull(),
  arquivoId: uuid("arquivo_id"),
  numeroLinha: integer("numero_linha"),
  /** SHA-256 da linha normalizada. */
  hash: text("hash").notNull(),
  /** Sigla e número do CT-e da linha (nulos quando o relatório não é por CT-e, ex.: 050). */
  sigla: text("sigla"),
  numero: text("numero"),
  /** Dia de referência da linha (emissão, ocorrência ou saída, conforme o relatório). */
  dataReferencia: instante("data_referencia"),
  /** Linha parseada (tipada pelo schema zod do relatório no worker). */
  dados: jsonb("dados").notNull(),
  importadoEm: instante("importado_em").notNull().defaultNow(),
  /** Quando a linha foi aplicada em `ctes`/`ocorrencias`/projeções. Nulo = pendente. */
  aplicadoEm: instante("aplicado_em"),
});

export const ingestaoErros = erp.table("ingestao_erros", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  empresaId: empresaId(),
  relatorio: text("relatorio").notNull(),
  loteId: uuid("lote_id").notNull(),
  etapa: text("etapa", { enum: ["analise", "gravacao"] }).notNull(),
  arquivoOrigem: text("arquivo_origem"),
  numeroLinha: integer("numero_linha"),
  linhaBruta: text("linha_bruta"),
  motivo: text("motivo").notNull(),
  criadoEm: criadoEm(),
});

export const ingestaoAplicacoes = erp.table("ingestao_aplicacoes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  /** Usuário que disparou; nulo = worker. */
  aplicadoPor: uuid("aplicado_por"),
  status: text("status", { enum: ["em_andamento", "concluido", "erro"] })
    .notNull()
    .default("em_andamento"),
  simulacao: boolean("simulacao").notNull(),
  totalInseridos: integer("total_inseridos").notNull().default(0),
  totalAtualizados: integer("total_atualizados").notNull().default(0),
  totalOcorrencias: integer("total_ocorrencias").notNull().default(0),
  /** CT-e não aplicados (ex.: número ocupado por outra série). Primeiro lugar a olhar se "sumiu CT-e". */
  totalIgnorados: integer("total_ignorados").notNull().default(0),
  /** Detalhe da aplicação (amostras, contagens por relatório). */
  detalhe: jsonb("detalhe"),
  erro: text("erro"),
  iniciadoEm: instante("iniciado_em").notNull().defaultNow(),
  finalizadoEm: instante("finalizado_em"),
});
