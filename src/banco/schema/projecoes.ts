/**
 * Projeções: tabelas de leitura que substituem as views materializadas e as views do sistema
 * atual. São mantidas pelo worker a partir das linhas de relatório que chegam (036, 306, 038,
 * 455); a regra de manutenção é da spec da ingestão. Nenhuma tela grava nelas.
 *
 * Chave sempre por empresa + sigla + número do CT-e (as matviews de hoje casavam só pelo número,
 * que se repete entre séries). A junção com `ctes` é pela chave natural
 * (`ctes_empresa_sigla_numero_uq`), sem FK: o relatório pode citar CT-e que ainda não existe ou
 * que está fora da trava de emissão mínima.
 *
 * A retenção das linhas de relatório (`ingestao_linhas`) NÃO apaga projeção: a projeção é o
 * estado acumulado; antes, apagar staging 036 apagava `romaneio_saida_ctrc` por gatilho.
 */
import { boolean, date, numeric, text } from "drizzle-orm/pg-core";

import { atualizadoEm, empresaId, instante } from "./_comum";
import { erp } from "./base";

const dia = (nome: string) => date(nome, { mode: "string" });

/**
 * Romaneio por viagem: uma linha por CT-e por romaneio (036), já sem romaneio cancelado, com a
 * ordem das viagens do CT-e. Base das telas de Romaneio (performance por carro/ajudante/
 * motorista, notas por carro, motivos de não entrega, prejuízo, opções de placa/motorista).
 *
 * Mantida assim: para cada (CT-e, romaneio) vale a linha 036 importada por último; descarta
 * situação CANCELADO; reordena as viagens do CT-e por (data_saida, hora_saida nulls first,
 * romaneio) e regrava primeira/ultima/proxima_saida do CT-e inteiro.
 *
 * Substitui: public.mv_romaneio_viagem_ctrc.
 */
export const romaneioViagensCte = erp.table("romaneio_viagens_cte", {
  empresaId: empresaId(),
  sigla: text("sigla").notNull(),
  numero: text("numero").notNull(),
  romaneio: text("romaneio").notNull(),
  situacao: text("situacao"),
  dataSaida: dia("data_saida").notNull(),
  /** Hora de emissão do romaneio como vem do 036 (só desempata a ordem das viagens). */
  horaSaida: text("hora_saida"),
  /** Placa normalizada (só A–Z e 0–9, maiúscula). */
  placa: text("placa"),
  motorista: text("motorista"),
  /** Motorista normalizado (maiúsculo, espaços simples): filtro e agrupamento. */
  motoristaNormalizado: text("motorista_normalizado"),
  ajudante: text("ajudante"),
  ajudante2: text("ajudante_2"),
  ajudante3: text("ajudante_3"),
  /** Primeira viagem do CT-e. */
  primeira: boolean("primeira").notNull(),
  /** Última viagem do CT-e. */
  ultima: boolean("ultima").notNull(),
  /** Data de saída da viagem seguinte do mesmo CT-e (nula na última). */
  proximaSaida: dia("proxima_saida"),
  atualizadoEm: atualizadoEm(),
});

/**
 * Datas de saída em romaneio de cada CT-e: o conjunto (CT-e, dia) de todas as linhas 036 não
 * canceladas, de qualquer importação. Usada pelo filtro de período "saída para entrega" e pela
 * performance por carro/ajudante.
 *
 * Substitui: public.romaneio_saida_ctrc (mantida por gatilho em staging_036) e a view
 * public.mv_ctrc_saida_romaneio.
 */
export const romaneioSaidasCte = erp.table("romaneio_saidas_cte", {
  empresaId: empresaId(),
  sigla: text("sigla").notNull(),
  numero: text("numero").notNull(),
  dataSaida: dia("data_saida").notNull(),
});

/**
 * Situação atual de romaneio do CT-e: a linha 036 mais recente (por importação, romaneio,
 * BAIXADO primeiro, data/hora da ocorrência, emissão) somada à linha 306 (SSW Mobile) mais
 * recente. Placa e motorista que as telas mostram: do 036; sem 036 (ou 036 sem placa), do 306.
 *
 * As duas partes ficam guardadas separadas porque as linhas de relatório expiram (60 dias): o
 * recálculo de um CT-e com 306 novo e 036 já expirado reaproveita a parte 036 gravada.
 *
 * Usada pela lista do Romaneio (placa/motorista e busca), Listagem detalhada, motivos de não
 * entrega (ajudantes) e pela aplicação do 036 no CT-e (`ctes.ocorr_036_*`).
 *
 * Substitui: public.mv_romaneio_036_ctrc + view romaneio_036_ctrc,
 * public.mv_romaneio_ctrc_motorista + views romaneio_ctrc_motorista(_v2/_306).
 */
export const romaneioCteAtual = erp.table("romaneio_cte_atual", {
  empresaId: empresaId(),
  sigla: text("sigla").notNull(),
  numero: text("numero").notNull(),
  /** Placa normalizada que as telas mostram: 036, senão 306. */
  placa: text("placa"),
  /** Motorista que as telas mostram: 036, senão 306. */
  motorista: text("motorista"),

  // Do 036 mais recente
  /** true = existe linha 036 para o CT-e. */
  tem036: boolean("tem_036").notNull(),
  romaneio: text("romaneio"),
  situacao: text("situacao"),
  placa036: text("placa_036"),
  motorista036: text("motorista_036"),
  ajudante: text("ajudante"),
  ajudante2: text("ajudante_2"),
  ajudante3: text("ajudante_3"),
  codOcorr036: text("cod_ocorr_036"),
  descOcorr036: text("desc_ocorr_036"),
  /** Data + hora da ocorrência do CT-e no 036, em America/Sao_Paulo (hora vazia = 12:00). */
  dataOcorr036: instante("data_ocorr_036"),
  dataEmissao036: dia("data_emissao_036"),

  // Do 306 mais recente
  /** true = existe linha 306 para o CT-e. */
  tem306: boolean("tem_306").notNull(),
  placa306: text("placa_306"),
  motorista306: text("motorista_306"),
  data306: dia("data_306"),

  atualizadoEm: atualizadoEm(),
});

/**
 * Dados do CT-e pelos relatórios de pendentes (038) e expedidos (455) mais recentes: setor,
 * bairro, endereço e CEP do 038; valor da mercadoria do 038, senão do 455. Usada pela lista do
 * Romaneio (colunas, agrupamento por setor e exportação). As partes 038/455 ficam guardadas pelo
 * mesmo motivo de `romaneio_cte_atual`.
 *
 * Substitui: public.mv_ctrc_staging_enriquecido + view ctrc_staging_enriquecido.
 */
export const cteDadosRelatorios = erp.table("cte_dados_relatorios", {
  empresaId: empresaId(),
  sigla: text("sigla").notNull(),
  numero: text("numero").notNull(),
  /** Valor da mercadoria que as telas mostram: 038, senão 455. */
  valorMercadoria: numeric("valor_mercadoria", { precision: 14, scale: 2 }),
  // Do 038 mais recente
  /** true = existe linha 038 para o CT-e. */
  tem038: boolean("tem_038").notNull(),
  setor: text("setor"),
  bairro: text("bairro"),
  endereco: text("endereco"),
  cep: text("cep"),
  valorMercadoria038: numeric("valor_mercadoria_038", { precision: 14, scale: 2 }),
  // Do 455 mais recente
  valorMercadoria455: numeric("valor_mercadoria_455", { precision: 14, scale: 2 }),
  atualizadoEm: atualizadoEm(),
});

/**
 * Conferente e romaneio do CT-e pela linha 036 que vale para a tela Ocorrências (filtro e coluna
 * "Conferente"/"Romaneio" da lista e seletor de conferentes).
 *
 * Mantida assim: para cada CT-e (sigla + número), entre as linhas 036 com romaneio e situação
 * diferente de CANCELADO (situação nula passa), vale a primeira por data_ocorr_ctrc DESC NULLS
 * LAST, hora_ocorr_ctrc DESC NULLS LAST, (situação = BAIXADO) DESC com situação nula antes,
 * data_emissao DESC NULLS LAST, importado_em DESC. `conferente` = btrim, vazio → nulo.
 * A ordem é diferente da de `romaneio_cte_atual`, por isso é outra projeção.
 *
 * Substitui: _ocorrencias_conferente_romaneio e ocorrencias_conferentes_opcoes (sistema atual),
 * que liam a staging 036 (que agora tem retenção de 60 dias e não pode ser a fonte).
 */
export const romaneioConferenteCte = erp.table("romaneio_conferente_cte", {
  empresaId: empresaId(),
  sigla: text("sigla").notNull(),
  numero: text("numero").notNull(),
  conferente: text("conferente"),
  romaneio: text("romaneio").notNull(),
  atualizadoEm: atualizadoEm(),
});
