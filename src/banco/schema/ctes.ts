/**
 * Agregado CT-e.
 *
 * - `ctes`: um conhecimento de transporte (o `ctrcs` do sistema atual). Identidade natural =
 *   empresa + sigla + número: o número sozinho se repete entre séries (CAP033214 ≠ CAS033214),
 *   e casar só pelo número já misturou CT-e no sistema atual.
 * - `cte_prazo_historico`: cada troca de `data_prevista_entrega` (antes gatilho
 *   `_trg_ctrcs_log_prazo`; agora gravado pelo caso de uso que muda a previsão).
 *
 * Colunas marcadas "calculada pelo backend" eram gatilho no sistema atual: o caso de uso que grava
 * o CT-e (ou a ocorrência / o catálogo de que elas dependem) recalcula e grava na mesma transação.
 * Nunca são gravadas soltas por outro caminho.
 *
 * Datas de negócio (emissão, previsão, conclusão) são `date` (dia em America/Sao_Paulo);
 * instantes (entrega, ocorrências) são `timestamptz`.
 *
 * Origem: public.ctrcs, public.ctrc_prazo_historico.
 */
import { FONTES_DE_PRAZO } from "@erp/shared/domain/deadline";
import { sql } from "drizzle-orm";
import { bigint, boolean, date, integer, numeric, smallint, text, uuid } from "drizzle-orm/pg-core";

import { atualizadoEm, criadoEm, empresaId, instante } from "./_comum";
import { erp } from "./base";

export const prazoOrigem = erp.enum("prazo_origem", ["proprio", "parceiro"]);

/** De onde veio a previsão de entrega gravada (lista única em @erp/shared). */
export const fontesDePrazo = FONTES_DE_PRAZO;

const dia = (nome: string) => date(nome, { mode: "string" });

export const ctes = erp.table("ctes", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),

  // Identidade
  /** Série/sigla do CT-e no SSW (ex.: CAP, CAS). Maiúscula. */
  sigla: text("sigla").notNull(),
  /** Número do CTRC só com dígitos e sem zero à esquerda (como `ssw_num_ctrc`). */
  numero: text("numero").notNull(),
  /** Chave de 44 dígitos do CT-e (XML). */
  chave: text("chave"),
  siglaCte: text("sigla_cte"),
  numeroCte: bigint("numero_cte", { mode: "number" }),
  tipoDocumento: text("tipo_documento"),
  /** Tipo segundo o 455 (classificação detalhada do SSW); vence o `tipo_documento` do BI2. */
  tipoDocumento455: text("tipo_documento_455"),
  /** CT-e certo do qual este é cópia (número inexistente no SSW). Preenchido = fora das telas. */
  duplicadoDe: uuid("duplicado_de"),

  // Datas de negócio
  dataEmissao: dia("data_emissao").notNull(),
  // calculada pelo backend: menor dia (America/Sao_Paulo) das ocorrências 82/85 do CT-e. origem: sync_data_embarque_from_ocorrencia
  dataEmbarque: dia("data_embarque"),
  dataEntregaRealizada: instante("data_entrega_realizada"),
  // calculada pelo backend: dia (SP) de data_entrega_realizada; sem ela, dia (SP) de ocorr_efetiva_data quando a ocorrência efetiva é de entrega ou finalizadora sem entrega. origem: _calc_data_conclusao_efetiva
  dataConclusaoEfetiva: dia("data_conclusao_efetiva"),

  // Relacionamentos
  unidadeId: uuid("unidade_id"),
  parceiroId: uuid("parceiro_id"),
  equipeId: uuid("equipe_id"),

  // Partes
  remetente: text("remetente"),
  cnpjRemetente: text("cnpj_remetente"),
  destinatario: text("destinatario"),
  cnpjDestinatario: text("cnpj_destinatario"),
  pagadorNome: text("pagador_nome"),
  pagadorCnpj: text("pagador_cnpj"),
  // calculada pelo backend: só os dígitos de pagador_cnpj (filtro de pagador da tela e índice). origem: regexp_replace(pagador_cnpj, '\D', '') das RPCs
  pagadorCnpjDigitos: text("pagador_cnpj_digitos"),
  /** Expedidor do CT-e pelo 455 (rótulo "parceiro" das telas). */
  parceiroCnpj: text("parceiro_cnpj"),
  parceiroNome: text("parceiro_nome"),

  // Destino
  cidadeDestino: text("cidade_destino"),
  ufDestino: text("uf_destino"),
  bairroDestino: text("bairro_destino"),
  logradouroDestino: text("logradouro_destino"),
  numeroEnderecoDestino: text("numero_endereco_destino"),
  complementoDestino: text("complemento_destino"),
  cepDestinatario: text("cep_destinatario"),
  setor: text("setor"),
  setorDestino: text("setor_destino"),

  // Unidades / filiais (siglas SSW)
  filial: text("filial"),
  unidadeOrigem: text("unidade_origem"),
  unidadeDestino: text("unidade_destino"),
  unidadeAtual: text("unidade_atual"),
  localizacaoAtual: text("localizacao_atual"),
  // calculada pelo backend: coalesce(unidade_destino, unidade_atual, filial) — a sigla que decide o universo (filial própria) e o filtro de filial das telas. origem: expressão repetida nas RPCs
  filialEfetiva: text("filial_efetiva"),
  // calculada pelo backend: cidade da filial (filiais.sigla = filial). origem: _trg_ctrcs_unidade_cidade_por_filial
  unidadeCidade: text("unidade_cidade"),
  // calculada pelo backend: UF da filial (filiais.sigla = filial). origem: _trg_ctrcs_unidade_cidade_por_filial
  unidadeUf: text("unidade_uf"),

  // Nota fiscal e carga
  chaveNfe: text("chave_nfe"),
  numeroNf: integer("numero_nf"),
  serieNf: text("serie_nf"),
  peso: numeric("peso", { precision: 12, scale: 3 }),
  volumes: integer("volumes"),
  valorFrete: numeric("valor_frete", { precision: 14, scale: 2 }),
  valorMercadoria: numeric("valor_mercadoria", { precision: 14, scale: 2 }),
  /** Taxa de dificuldade de entrega (455). */
  tde: numeric("tde", { precision: 14, scale: 2 }),
  nroManifesto: text("nro_manifesto"),
  primeiroManifesto: text("primeiro_manifesto"),
  ultimoManifesto: text("ultimo_manifesto"),

  // Prazo
  prazoEntrega: dia("prazo_entrega"),
  prazoOrigem: prazoOrigem("prazo_origem").notNull().default("proprio"),
  prazoContratadoDias: integer("prazo_contratado_dias"),
  prazoFonte: text("prazo_fonte", { enum: fontesDePrazo }),
  dataBasePrazo: instante("data_base_prazo"),
  dataPrevistaEntrega: dia("data_prevista_entrega"),
  // Última previsão vinda do SSW (038/930/XML), guardada à parte para o CT-e voltar a ela quando a
  // regra de prazo configurado sai (decisão Q19). Gravada pela ingestão; lida pelo núcleo.
  previsaoSswData: dia("previsao_ssw_data"),
  previsaoSswFonte: text("previsao_ssw_fonte", { enum: fontesDePrazo }),
  previsaoSswDataBase: instante("previsao_ssw_data_base"),
  // calculada pelo backend: 2 dias corridos (48 h); nulo para pagador/parceiro com raiz de CNPJ 00193687 (TROCA). origem: prazo_padrao_do_ctrc
  prazoPadraoDias: smallint("prazo_padrao_dias"),
  // calculada pelo backend: data_emissao + prazo_padrao_dias; nulo se a previsão é anterior à emissão. Nascido em atraso = previsão < esta data. origem: prazo_padrao_data_do_ctrc
  prazoPadraoData: dia("prazo_padrao_data"),

  // Performance (BI2 0017 / SLA pelos arquivos)
  performanceDias: integer("performance_dias"),
  noPrazo: boolean("no_prazo"),
  responsabilidadeCliente: boolean("responsabilidade_cliente"),
  fontePerformance: text("fonte_performance"),
  /** Foto do BI2 0013: não avança com os dias (aberto = hoje − previsão, calculado na consulta). */
  atrasoDias: integer("atraso_dias"),

  // Operação
  // calculada pelo backend: descrição (ou a do catálogo) da ocorrência mais recente por data_hora. origem: sync_status_atual_from_ocorrencia
  statusAtual: text("status_atual"),
  motoristaNome: text("motorista_nome"),
  ajudanteNome: text("ajudante_nome"),
  placaColeta: text("placa_coleta"),
  placaEntrega: text("placa_entrega"),
  comprovanteEscaneado: boolean("comprovante_escaneado"),
  comprovanteEscaneadoEm: instante("comprovante_escaneado_em"),

  // Fontes da ocorrência efetiva
  ultimaOcorrCodigo0013: text("ultima_ocorr_codigo_0013"),
  ultimaOcorrData0013: instante("ultima_ocorr_data_0013"),
  ultOcorrCodigo0174: text("ult_ocorr_codigo_0174"),
  ultOcorrDescricao0174: text("ult_ocorr_descricao_0174"),
  ultOcorrData0174: instante("ult_ocorr_data_0174"),
  ultOcorrLocal0174: text("ult_ocorr_local_0174"),
  ultOcorrInstrucao0174: text("ult_ocorr_instrucao_0174"),
  ocorr036Codigo: text("ocorr_036_codigo"),
  ocorr036Descricao: text("ocorr_036_descricao"),
  ocorr036Data: instante("ocorr_036_data"),

  // Ocorrência efetiva
  // calculada pelo backend: ocorrência que vale para o CT-e entre 0174, 0013, 036 e ocorrências (930/webhook), com a precedência e o estorno (86) da spec. origem: _calc_ocorr_efetiva / recompute_ocorr_efetiva
  ocorrEfetivaCodigo: text("ocorr_efetiva_codigo"),
  // calculada pelo backend: dígitos de ocorr_efetiva_codigo como número (filtro de códigos das telas). origem: norm_codigo_ocorr
  ocorrEfetivaCodigoNum: smallint("ocorr_efetiva_codigo_num"),
  // calculada pelo backend: junto com ocorr_efetiva_codigo. origem: _calc_ocorr_efetiva
  ocorrEfetivaDescricao: text("ocorr_efetiva_descricao"),
  // calculada pelo backend: junto com ocorr_efetiva_codigo. origem: _calc_ocorr_efetiva
  ocorrEfetivaData: instante("ocorr_efetiva_data"),
  // calculada pelo backend: junto com ocorr_efetiva_codigo (qual fonte venceu). origem: _calc_ocorr_efetiva
  ocorrEfetivaFonte: text("ocorr_efetiva_fonte"),
  // calculada pelo backend: junto com ocorr_efetiva_codigo. origem: _calc_ocorr_efetiva
  ocorrEfetivaLocal: text("ocorr_efetiva_local"),

  // Cancelamento
  // gravada pela ingestão do XML: instante do evento de cancelamento do CT-e (`dhEvento`). A trava do BI2 lê: CT-e cancelado não conta como em andamento. origem: ctrcs.cancelado_em / _trg_ctrcs_bi2_preserva_ssw
  canceladoEm: instante("cancelado_em"),

  // Universo
  // calculada pelo backend: existe ocorrência 99 cujo dia (SP) = data_emissao. Recalcula quando muda a emissão ou entra/sai ocorrência 99. origem: _trg_ctrcs_calc_cancelado_mesmo_dia / _trg_ocorrencias_recompute_cancelado
  canceladoMesmoDia: boolean("cancelado_mesmo_dia").notNull().default(false),
  // calculada pelo backend: cancelado_mesmo_dia OU duplicado_de preenchido. true = fora de todas as telas. origem: _trg_ctrcs_fora_universo
  foraUniverso: boolean("fora_universo").notNull().default(false),
  // calculada pelo backend: colunas cujo valor veio dos relatórios SSW (038/455/930/036); o BI2 não sobrescreve essas colunas. origem: aplicar_staging_ssw / _trg_ctrcs_bi2_preserva_ssw
  camposSsw: text("campos_ssw")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),

  criadoEm: criadoEm(),
  atualizadoEm: atualizadoEm(),
});

export const ctePrazoHistorico = erp.table("cte_prazo_historico", {
  id: uuid("id").primaryKey().defaultRandom(),
  empresaId: empresaId(),
  cteId: uuid("cte_id").notNull(),
  dataAnterior: dia("data_anterior"),
  dataNova: dia("data_nova"),
  /** `prazo_fonte` do CT-e no momento da troca. */
  fonte: text("fonte"),
  criadoEm: criadoEm(),
});
