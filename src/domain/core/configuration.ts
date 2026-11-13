/**
 * Configurações da empresa que o núcleo usa (`configuracoes`, chave → texto). Os valores fixos da
 * FR viraram configuração, com os valores da FR como padrão (Q48 do dono).
 */
import { ehDataIso } from "@erp/shared/dates";

import { ErroDeNegocio } from "../errors";
import { type ConfiguracaoDoPrazoPadrao } from "./deadline";
import { type DataIso } from "./time";

export interface ConfiguracaoDoNucleo extends ConfiguracaoDoPrazoPadrao {
  /** Dias para "sem movimento". origem: _alerta_dias_sem_movimento (padrão 3) */
  limiteSemMovimento: number;
  /** CT-e emitido antes não é criado; `null` = sem trava. origem: _trg_ctrcs_data_minima_emissao */
  dataMinimaEmissao: DataIso | null;
}

/** Padrões (os da FR) quando a chave não existe ou está vazia. */
export const CONFIGURACAO_PADRAO: ConfiguracaoDoNucleo = {
  limiteSemMovimento: 3,
  dataMinimaEmissao: null,
  prazoPadraoDias: 2,
  raizCnpjTroca: "00193687",
};

interface Formato<T> {
  ler: (texto: string) => T | undefined;
  descricao: string;
}

const DIAS: Formato<number> = {
  ler: (t) => (/^\d+$/.test(t) ? Number.parseInt(t, 10) : undefined),
  descricao: "um número inteiro de dias",
};
const DATA: Formato<DataIso> = {
  ler: (t) => (ehDataIso(t) ? t : undefined),
  descricao: "uma data AAAA-MM-DD",
};
const RAIZ_CNPJ: Formato<string> = {
  ler: (t) => (/^\d{8}$/.test(t) ? t : undefined),
  descricao: "os 8 primeiros dígitos do CNPJ",
};

/** Lê as configurações da empresa; ausente ou vazia vale o padrão. */
export function lerConfiguracaoDoNucleo(
  valores: ReadonlyMap<string, string>,
): ConfiguracaoDoNucleo {
  const ler = <T>(chave: string, formato: Formato<T>) =>
    lerValor(chave, valores.get(chave) ?? "", formato);
  const p = CONFIGURACAO_PADRAO;
  return {
    limiteSemMovimento: ler("alerta_dias_sem_movimento", DIAS) ?? p.limiteSemMovimento,
    dataMinimaEmissao: ler("ctrc_data_minima_emissao", DATA) ?? p.dataMinimaEmissao,
    prazoPadraoDias: ler("prazo_padrao_dias", DIAS) ?? p.prazoPadraoDias,
    raizCnpjTroca: ler("raiz_cnpj_troca", RAIZ_CNPJ) ?? p.raizCnpjTroca,
  };
}

function lerValor<T>(chave: string, valor: string, formato: Formato<T>): T | undefined {
  const texto = valor.trim();
  if (texto === "") return undefined;
  const lido = formato.ler(texto);
  if (lido === undefined) {
    throw new ErroDeNegocio(
      "ENTRADA_INVALIDA",
      `Valor inválido para "${chave}": informe ${formato.descricao}.`,
    );
  }
  return lido;
}
