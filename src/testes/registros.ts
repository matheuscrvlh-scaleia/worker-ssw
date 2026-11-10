/** Registros de relatório de teste (dados anonimizados) com todos os campos. */
import {
  COLUNAS_455_CSV,
  type Registro036,
  type Registro038,
  type Registro455Csv,
  type Registro930,
} from "../fontes/relatorios";

export function r930(extra: Partial<Registro930> = {}): Registro930 {
  return {
    ctrc: "CAP033214-5",
    emissao_ctrc: "2026-11-03",
    serie_cte: "1",
    nro_cte: "55001",
    serie_nota_fiscal: "1",
    nro_nota_fiscal: "12345",
    pedido: null,
    empr_ocor: "FRT",
    unid_ocor: "CAP",
    inclusao_em: null,
    ocorrencia_em: null,
    usuario_ocor: "usuario",
    cod_ocor: null,
    descricao_ocor: null,
    complemento_ocor: null,
    data_entrega: null,
    descr_item: null,
    primeiro_manifesto: null,
    cancelado: null,
    cnpj_pagador: "11222333000181",
    nome_pagador: "CLIENTE EXEMPLO LTDA",
    ...extra,
  };
}

export function r038(extra: Partial<Registro038> = {}): Registro038 {
  return {
    sem_prazo_definido: false,
    ctrc: "CAP033214-5",
    nota_fiscal: "12345",
    remetente: "REMETENTE X",
    destinatario: "DESTINO Y",
    endereco: "RUA A 1",
    cidade: "RIO DE JANEIRO",
    bairro: "CENTRO",
    cep: "20000000",
    setor: "R07",
    valor_mercadoria: 1500.5,
    quantidade_volumes: 3,
    peso: 12.25,
    prazo_entrega: "2026-11-12",
    atraso: 0,
    ultima_ocorrencia: null,
    localizacao: "FRT CAP - EM TRANSITO",
    ...extra,
  };
}

export function r455(extra: Partial<Registro455Csv> = {}): Registro455Csv {
  const base = Object.fromEntries(COLUNAS_455_CSV.map((c) => [c.coluna, null])) as Registro455Csv;
  return {
    ...base,
    serie_numero_ctrc: "CAP033214-5",
    data_de_emissao: "2026-11-03",
    hora_de_emissao: "10:00",
    ...extra,
  };
}

export function r036(extra: Partial<Registro036> = {}): Registro036 {
  const nulos = {} as Record<keyof Registro036, null>;
  for (const k of [
    "romaneio",
    "data_emissao",
    "hora_emissao",
    "situacao",
    "placa",
    "placa_carreta",
    "motorista",
    "cpf_motorista",
    "seguradora",
    "autorizacao",
    "validade",
    "ctrc",
    "tipo_frete",
    "nome_remetente",
    "nome_destinatario",
    "cnpj_pagador",
    "nome_pagador",
    "cidade_pagador",
    "cidade_entrega",
    "cep_entrega",
    "local_entrega",
    "bairro",
    "setor_dest",
    "cod_ocorr_rom",
    "desc_ocorr_rom",
    "data_ocorr_rom",
    "hora_ocorr_rom",
    "cod_ocorr_ctrc",
    "desc_ocorr_ctrc",
    "data_ocorr_ctrc",
    "hora_ocorr_ctrc",
    "frete_ctrc_origem",
    "frete_ctrc",
    "peso_calculo",
    "qtde_vol",
    "vlr_merc",
    "cod_merc",
    "serie_nf",
    "numero_nf",
    "nro_pedido",
    "conferente",
    "ajudante",
    "ajudante_2",
    "ajudante_3",
    "emitido_por",
    "prev_entrega_ctrc",
  ] as const) {
    nulos[k] = null;
  }
  return { ...nulos, ctrc: "CAP033214-5", ...extra };
}
