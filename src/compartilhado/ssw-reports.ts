/**
 * Linha de cada relatório SSW como o leitor de `@erp/ingestao/relatorios` a produz e como ela fica
 * guardada em `ingestao_linhas.dados`: o tipo do registro de cada leitor sai daqui, e quem lê a
 * linha guardada (Romaneio, projeções) valida com o mesmo schema. Nomes e formatos da spec
 * (docs/regras/06-ingestao.md §2.1 e §3): datas `AAAA-MM-DD`, números já convertidos.
 *
 * Campo ausente vira nulo: as linhas migradas do sistema atual (`to_jsonb` da staging) passam
 * pelo mesmo schema.
 */
import { z } from "./zod";

const texto = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const numero = z
  .number()
  .nullish()
  .transform((v) => v ?? null);

/** 036 — Romaneios e CTRCs de Entrega (46 colunas). */
export const registro036 = z.object({
  romaneio: texto,
  data_emissao: texto,
  hora_emissao: texto,
  situacao: texto,
  placa: texto,
  placa_carreta: texto,
  motorista: texto,
  cpf_motorista: texto,
  seguradora: texto,
  autorizacao: texto,
  validade: texto,
  ctrc: texto,
  tipo_frete: texto,
  nome_remetente: texto,
  nome_destinatario: texto,
  cnpj_pagador: texto,
  nome_pagador: texto,
  cidade_pagador: texto,
  cidade_entrega: texto,
  cep_entrega: texto,
  local_entrega: texto,
  bairro: texto,
  setor_dest: texto,
  cod_ocorr_rom: texto,
  desc_ocorr_rom: texto,
  data_ocorr_rom: texto,
  hora_ocorr_rom: texto,
  cod_ocorr_ctrc: texto,
  desc_ocorr_ctrc: texto,
  data_ocorr_ctrc: texto,
  hora_ocorr_ctrc: texto,
  frete_ctrc_origem: numero,
  frete_ctrc: numero,
  peso_calculo: numero,
  qtde_vol: numero,
  vlr_merc: numero,
  cod_merc: texto,
  serie_nf: texto,
  numero_nf: texto,
  nro_pedido: texto,
  conferente: texto,
  ajudante: texto,
  ajudante_2: texto,
  ajudante_3: texto,
  emitido_por: texto,
  prev_entrega_ctrc: texto,
});
export type Registro036 = z.output<typeof registro036>;

/** 038 — CTRCs Pendentes de Entrega (por unidade). */
export const registro038 = z.object({
  sem_prazo_definido: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  ctrc: texto,
  nota_fiscal: texto,
  remetente: texto,
  destinatario: texto,
  endereco: texto,
  cidade: texto,
  bairro: texto,
  cep: texto,
  setor: texto,
  valor_mercadoria: numero,
  quantidade_volumes: numero,
  peso: numero,
  prazo_entrega: texto,
  atraso: numero,
  ultima_ocorrencia: texto,
  localizacao: texto,
});
export type Registro038 = z.output<typeof registro038>;

/** 306 — Situação de Uso do SSWMobile. */
export const registro306 = z.object({
  placa: texto,
  ctrc_coleta: texto,
  data: texto,
  motorista: texto,
  remetente: texto,
  uf_cidade_origem: texto,
  setor_origem: texto,
  destinatario: texto,
  uf_cidade_destino: texto,
  unidade_destino: texto,
  setor_destino: texto,
  data_previsao_entrega: texto,
  ocorrencia_mobile: texto,
  ocorrencia_atual: texto,
});
export type Registro306 = z.output<typeof registro306>;

/** 930 — Gera BD de Ocorrências. */
export const registro930 = z.object({
  ctrc: texto,
  emissao_ctrc: texto,
  serie_cte: texto,
  nro_cte: texto,
  serie_nota_fiscal: texto,
  nro_nota_fiscal: texto,
  pedido: texto,
  empr_ocor: texto,
  unid_ocor: texto,
  /** "AAAA-MM-DDThh:mm:00", horário de SP sem fuso. */
  inclusao_em: texto,
  /** "AAAA-MM-DDThh:mm:00", horário de SP sem fuso. */
  ocorrencia_em: texto,
  usuario_ocor: texto,
  cod_ocor: texto,
  descricao_ocor: texto,
  complemento_ocor: texto,
  data_entrega: texto,
  descr_item: texto,
  primeiro_manifesto: texto,
  cancelado: texto,
  cnpj_pagador: texto,
  nome_pagador: texto,
});
export type Registro930 = z.output<typeof registro930>;

/**
 * 455 CSV — as colunas configuráveis (`COLUNAS_455_CSV` do leitor) que alguém lê da linha
 * guardada. A linha inteira é `Registro455Csv` do leitor.
 */
export const registro455Csv = z.object({ valor_da_mercadoria: numero });
