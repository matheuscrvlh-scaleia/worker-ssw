/**
 * 930 — Gera BD de Ocorrências. CSV com `;` e aspas; `0;` = cabeçalho de colunas, `1;` = dado
 * (24 campos); outra linha não vazia é erro. Datas e horas em São Paulo, sem fuso.
 * origem: src/features/ssw/server/parse-930.server.ts (sistema atual)
 */
import { type Registro930 } from "@erp/shared/ssw-reports";

import { dataBR, limpa, linhasDoArquivo, splitCsv, timestampBR, txt } from "./texto";
import { type Analise, diferencasDeCabecalho, type ErroDeLeitura, type LinhaLida } from "./tipos";

export const CABECALHO_930 = [
  "0",
  "CTRC",
  "EMISSAO_CTRC",
  "SERIE_CTE",
  "NRO_CTE",
  "SERIE_NOTA_FISCAL",
  "NRO_NOTA_FISCAL",
  "PEDIDO",
  "EMPR_OCOR",
  "UNID_OCOR",
  "DIA_INCLUSAO_OCOR",
  "HORA_INCLUSAO_OCOR",
  "DATA_OCOR",
  "HORA_OCOR",
  "USUARIO_OCOR",
  "COD_OCOR",
  "DESCRICAO_OCOR",
  "COMPLEMENTO_OCOR",
  "DATA_ENTREGA",
  "DESCR_ITEM",
  "PRIMEIRO_MANIFESTO",
  "CANCELADO",
  "CNPJ_PAGADOR",
  "NOME_PAGADOR",
] as const;

export type { Registro930 };

export function ler930(conteudo: string): Analise<Registro930> {
  const registros: LinhaLida<Registro930>[] = [];
  const erros: ErroDeLeitura[] = [];
  // `as`: o forEach muda a variável; sem ele o TS a estreita para o valor inicial.
  let cabecalho = null as string[] | null;

  linhasDoArquivo(conteudo).forEach((linha, idx) => {
    if (linha.trim() === "") return;
    const c = splitCsv(linha);
    const tipo = limpa(c[0]);
    if (tipo === "0") {
      cabecalho ??= c.map((x) => limpa(x));
      return;
    }
    if (tipo !== "1") {
      erros.push({
        linha: idx + 1,
        texto: linha,
        motivo: `linha não começa com "0;" nem "1;" (prefixo encontrado: "${tipo}")`,
      });
      return;
    }
    if (c.length !== CABECALHO_930.length) {
      erros.push({
        linha: idx + 1,
        texto: linha,
        motivo: `esperado ${CABECALHO_930.length} campos, encontrado ${c.length}`,
      });
      return;
    }
    registros.push({
      linha: idx + 1,
      dados: {
        ctrc: txt(c[1]),
        emissao_ctrc: dataBR(c[2]),
        serie_cte: txt(c[3]),
        nro_cte: txt(c[4]),
        serie_nota_fiscal: txt(c[5]),
        nro_nota_fiscal: txt(c[6]),
        pedido: txt(c[7]),
        empr_ocor: txt(c[8]),
        unid_ocor: txt(c[9]),
        inclusao_em: timestampBR(c[10], c[11]),
        ocorrencia_em: timestampBR(c[12], c[13]),
        usuario_ocor: txt(c[14]),
        cod_ocor: txt(c[15]),
        descricao_ocor: txt(c[16]),
        complemento_ocor: txt(c[17]),
        data_entrega: dataBR(c[18]),
        descr_item: txt(c[19]),
        primeiro_manifesto: txt(c[20]),
        cancelado: txt(c[21]),
        cnpj_pagador: txt(c[22]),
        nome_pagador: txt(c[23]),
      },
    });
  });

  const diferencas = cabecalho
    ? diferencasDeCabecalho(cabecalho, CABECALHO_930)
    : ['Linha de cabeçalho de colunas (iniciada por "0;") não encontrada no arquivo.'];
  return {
    registros,
    erros,
    cabecalhoDivergente: diferencas.length > 0,
    cabecalhoDiferencas: diferencas,
  };
}
