/**
 * 036 — Romaneios e CTRCs de Entrega. `0` título e `9` fim ignorados; `1` = cabeçalho (literal de
 * 46 colunas); `2` = dado com 47 campos (`split(";")`); outro marcador = erro.
 * origem: src/features/ssw/server/parse-036.server.ts (sistema atual)
 */
import { type Registro036 } from "@erp/shared/ssw-reports";

import { conferirCabecalhoLiteral } from "./r306";
import { dataBR4, inteiroSemPontos, limpa, linhasDoArquivo, numBR, txt } from "./texto";
import { type Analise, type ErroDeLeitura, type LinhaLida } from "./tipos";

export const CABECALHO_LITERAL_036 =
  "ROMANEIO;DATA EMISSAO;HORA EMISSAO;SITUACAO;PLACA;PLACA CARRETA;MOTORISTA;CPF DO MOTORISTA;SEGURADORA;AUTORIZACAO;VALIDADE;CTRC;TIPO DE FRETE;NOME REMETENTE;NOME DESTINATARIO;CNPJ PAGADOR;NOME PAGADOR;CIDADE PAGADOR;CIDADE_ENTREGA;CEP ENTREGA;LOCAL DE ENTREGA;BAIRRO;SETOR DEST;COD OCORR ROM;DESC OCORR ROM;DATA OCORR ROM;HORA OCORR ROM;COD OCORR CTRC;DESC OCORR CTRC;DATA OCORR CTRC;HORA OCORR CTRC;FRETE CTRC ORIGEM;FRETE CTRC;PESO CALCULO;QTDE VOL;VLR MERC;COD MERC;SERIE NF;NUMERO NF;NRO_PEDIDO;CONFERENTE;AJUDANTE;AJUDANTE_2;AJUDANTE_3;EMITIDO POR;PREV ENTREGA CTRC";

/** Marcador do tipo de linha + 46 colunas. */
const TOTAL_CAMPOS = 47;

export type { Registro036 };

export function ler036(conteudo: string): Analise<Registro036> {
  const registros: LinhaLida<Registro036>[] = [];
  const erros: ErroDeLeitura[] = [];
  let cabecalho: string | null = null;

  linhasDoArquivo(conteudo).forEach((linha, idx) => {
    if (linha.trim() === "") return;
    const c = linha.split(";");
    const marcador = limpa(c[0]);
    if (marcador === "0" || marcador === "9") return;
    if (marcador === "1") {
      cabecalho ??= c
        .slice(1)
        .join(";")
        .replace(/[\s\u00A0]+$/g, "");
      return;
    }
    if (marcador !== "2") {
      erros.push({
        linha: idx + 1,
        texto: linha,
        motivo: `marcador de tipo de linha desconhecido: "${marcador}"`,
      });
      return;
    }
    if (c.length !== TOTAL_CAMPOS) {
      erros.push({
        linha: idx + 1,
        texto: linha,
        motivo: `esperado ${TOTAL_CAMPOS} campos, encontrado ${c.length}`,
      });
      return;
    }
    registros.push({
      linha: idx + 1,
      dados: {
        romaneio: txt(c[1]),
        data_emissao: dataBR4(c[2]),
        hora_emissao: txt(c[3]),
        situacao: txt(c[4]),
        placa: txt(c[5]),
        placa_carreta: txt(c[6]),
        motorista: txt(c[7]),
        cpf_motorista: txt(c[8]),
        seguradora: txt(c[9]),
        autorizacao: txt(c[10]),
        validade: txt(c[11]),
        ctrc: txt(c[12]),
        tipo_frete: txt(c[13]),
        nome_remetente: txt(c[14]),
        nome_destinatario: txt(c[15]),
        cnpj_pagador: txt(c[16]),
        nome_pagador: txt(c[17]),
        cidade_pagador: txt(c[18]),
        cidade_entrega: txt(c[19]),
        cep_entrega: txt(c[20]),
        local_entrega: txt(c[21]),
        bairro: txt(c[22]),
        setor_dest: txt(c[23]),
        cod_ocorr_rom: txt(c[24]),
        desc_ocorr_rom: txt(c[25]),
        data_ocorr_rom: dataBR4(c[26]),
        hora_ocorr_rom: txt(c[27]),
        cod_ocorr_ctrc: txt(c[28]),
        desc_ocorr_ctrc: txt(c[29]),
        data_ocorr_ctrc: dataBR4(c[30]),
        hora_ocorr_ctrc: txt(c[31]),
        frete_ctrc_origem: numBR(c[32]),
        frete_ctrc: numBR(c[33]),
        peso_calculo: numBR(c[34]),
        qtde_vol: inteiroSemPontos(c[35]),
        vlr_merc: numBR(c[36]),
        cod_merc: txt(c[37]),
        serie_nf: txt(c[38]),
        numero_nf: txt(c[39]),
        nro_pedido: txt(c[40]),
        conferente: txt(c[41]),
        ajudante: txt(c[42]),
        ajudante_2: txt(c[43]),
        ajudante_3: txt(c[44]),
        emitido_por: txt(c[45]),
        prev_entrega_ctrc: dataBR4(c[46]),
      },
    });
  });

  return { registros, erros, ...conferirCabecalhoLiteral(cabecalho, CABECALHO_LITERAL_036) };
}
