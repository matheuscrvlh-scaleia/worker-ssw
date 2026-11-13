/**
 * Códigos de ocorrência do SSW: constantes fixas do padrão SSW, normalização do código e o
 * cadastro (catálogo) por empresa.
 */

export const TIPOS_SSW = [
  "ENTREGA",
  "PRE_ENTREGA",
  "INFORMATIVA",
  "PENDENCIA_CLIENTE",
  "PENDENCIA_TRANSPORTADORA",
  "BAIXA",
] as const;
export type TipoSsw = (typeof TIPOS_SSW)[number];

export const PROCESSOS_SSW = [
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
] as const;
export type ProcessoSsw = (typeof PROCESSOS_SSW)[number];

export const RESPONSAVEIS = [
  "FR",
  "transportador",
  "destinatario",
  "cliente",
  "sistema",
  "outro",
] as const;
export type Responsavel = (typeof RESPONSAVEIS)[number];

/** Entrega (padrão SSW, fixo). origem: _is_entregue; decisão codigos-finalizadores-2026-10-08 */
export const CODIGOS_ENTREGA: ReadonlySet<number> = new Set([1, 18, 67]);
/** origem: _saiu_entrega_status (sistema atual) */
export const CODIGOS_SAIU_ENTREGA: ReadonlySet<number> = new Set([
  85, 7, 9, 10, 13, 14, 17, 30, 31, 32, 33, 34, 38, 48, 63, 67, 70, 87, 88, 96,
]);
/** Saída para entrega: em rota e único código que destrava pendência. */
export const CODIGO_SAIDA_PARA_ENTREGA = 85;
/** Embarque: menor dia das 82/85. origem: sync_data_embarque_from_ocorrencia */
export const CODIGOS_EMBARQUE: ReadonlySet<number> = new Set([82, 85]);
/** Âncora da emissão. origem: sync_data_emissao_from_ocorrencia_80 */
export const CODIGO_ANCORA_EMISSAO = 80;
/** Cancelamento. origem: _is_cancelado_mesmo_dia */
export const CODIGO_CANCELAMENTO = 99;
/** Chegada na unidade (prazos configurados). origem: aplicar_prazo_configurado */
export const CODIGO_CHEGADA_NA_UNIDADE = 84;
const CODIGO_MINIMO = 0;
const CODIGO_MAXIMO = 99;

export const TIPOS_PENDENCIA: ReadonlySet<TipoSsw> = new Set([
  "PENDENCIA_CLIENTE",
  "PENDENCIA_TRANSPORTADORA",
]);

/** Tipo SSW do cadastro (texto) é pendência ("teve problema", travado, motivos). */
export const ehTipoPendencia = (tipo: string | null): boolean =>
  [...TIPOS_PENDENCIA].some((t) => t === tipo);

/** Código de entrega (1, 18, 67). */
export const ehCodigoEntrega = (codigo: number): boolean => CODIGOS_ENTREGA.has(codigo);

/** Linha do catálogo `codigos_ocorrencia` da empresa (o que o núcleo lê). */
export interface CodigoCadastrado {
  codigo: number;
  descricao: string;
  tipoSsw: TipoSsw | null;
  processoSsw: ProcessoSsw | null;
  responsavel: Responsavel;
  penaliza: boolean;
}

/** Catálogo da empresa do CT-e, por código. */
export type CatalogoDeCodigos = ReadonlyMap<number, CodigoCadastrado>;

export function montarCatalogo(codigos: readonly CodigoCadastrado[]): CatalogoDeCodigos {
  return new Map(codigos.map((c) => [c.codigo, c]));
}

/**
 * Códigos de baixa (finaliza sem entrega) = `tipo_ssw = 'BAIXA'` do cadastro **da empresa**
 * (Q22 do dono: substitui a lista fixa e o cadastro de qualquer empresa).
 * origem: _is_finalizado_sem_entrega, atraso_lista_dias (sistema atual)
 */
export function codigosDeBaixa(catalogo: CatalogoDeCodigos): ReadonlySet<number> {
  const baixa = new Set<number>();
  for (const c of catalogo.values()) if (c.tipoSsw === "BAIXA") baixa.add(c.codigo);
  return baixa;
}

/**
 * Código guardado como texto (efetiva, 0174, 0013, 036) → número, tirando tudo que não é dígito.
 * origem: norm_codigo_ocorr (sistema atual)
 */
export function normCodigoOcorr(texto: string | null): number | null {
  const digitos = (texto ?? "").replace(/\D/g, "");
  return digitos === "" ? null : Number.parseInt(digitos, 10);
}

/**
 * Código que precisa ser número puro (zeros à esquerda e espaços aceitos). Texto com letra vira
 * "sem código" em vez de derrubar a consulta como hoje (Q54 do dono).
 * origem: _normaliza_codigo_ocorr (sistema atual)
 */
export function codigoNumericoOuNulo(texto: string | null): number | null {
  const limpo = (texto ?? "").trim();
  return /^\d+$/.test(limpo) ? Number.parseInt(limpo, 10) : null;
}

export function ehCodigoValido(codigo: number): boolean {
  return Number.isInteger(codigo) && codigo >= CODIGO_MINIMO && codigo <= CODIGO_MAXIMO;
}
