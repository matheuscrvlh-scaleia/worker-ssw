/**
 * Agregado Coletas (relatório SSW 050, tela Coletas).
 *
 * Uma coleta por unidade + número. Gravada só pela ingestão do 050; a tela só lê.
 * O `status_prazo` da tela (vencida / vence hoje / a vencer / no prazo / atrasada) depende de
 * "agora" e por isso é calculado na consulta, não gravado. A `etapa` só depende da situação e é
 * gravada.
 *
 * Origem: public.coletas (+ colunas calculadas de public.vw_coletas).
 */
import { sql } from "drizzle-orm";
import { boolean, date, integer, jsonb, numeric, text } from "drizzle-orm/pg-core";

import { atualizadoEm, empresaId, instante } from "./_comum";
import { erp } from "./base";

export const etapasDeColeta = ["cadastrada", "comandada", "coletada", "cancelada"] as const;

export const coletas = erp.table("coletas", {
  empresaId: empresaId(),
  unidade: text("unidade").notNull(),
  numero: integer("numero").notNull(),
  tipo: text("tipo").notNull().default("NORMAL"),
  remetenteCnpj: text("remetente_cnpj"),
  remetenteNome: text("remetente_nome"),
  remetenteCidade: text("remetente_cidade"),
  setor: text("setor"),
  destinatarioCnpj: text("destinatario_cnpj"),
  destinatarioNome: text("destinatario_nome"),
  destinoCidade: text("destino_cidade"),
  solicitante: text("solicitante"),
  motorista: text("motorista"),
  placa: text("placa"),
  situacao: text("situacao"),
  // calculada pelo backend: situação CANCEL% → cancelada, COLETAD% → coletada, COMAND% → comandada, senão cadastrada. origem: vw_coletas.etapa
  etapa: text("etapa", { enum: etapasDeColeta }).notNull(),
  situacaoEm: instante("situacao_em"),
  limiteEm: instante("limite_em"),
  limiteInicial: date("limite_inicial", { mode: "string" }),
  cadastradaEm: instante("cadastrada_em"),
  cadastradaPor: text("cadastrada_por"),
  /** Dia (SP) do cadastro: período da tela. */
  diaCadastro: date("dia_cadastro", { mode: "string" }),
  comandadaEm: instante("comandada_em"),
  coletadaEm: instante("coletada_em"),
  canceladaEm: instante("cancelada_em"),
  valorMercadoria: numeric("valor_mercadoria", { precision: 14, scale: 2 }),
  volumes: integer("volumes"),
  pesoKg: numeric("peso_kg", { precision: 12, scale: 3 }),
  mercadoria: text("mercadoria"),
  tipoFrete: text("tipo_frete"),
  notasFiscais: text("notas_fiscais"),
  observacao: text("observacao"),
  /** CT-e gerado pela coleta (sigla + número): liga com `ctes` pela chave natural. */
  cteSigla: text("cte_sigla"),
  cteNumero: text("cte_numero"),
  romaneio: text("romaneio"),
  prejudicadaHorario: boolean("prejudicada_horario").notNull().default(false),
  /** Eventos da coleta como vieram do 050 (lista de {quando, situacao, ...}). */
  historico: jsonb("historico")
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** Emissão do relatório 050 que trouxe a versão gravada (a mais nova vence). */
  relatorioEmitidoEm: instante("relatorio_emitido_em").notNull(),
  arquivoOrigem: text("arquivo_origem"),
  atualizadoEm: atualizadoEm(),
});
