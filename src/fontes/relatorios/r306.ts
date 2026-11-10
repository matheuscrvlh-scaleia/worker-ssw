/**
 * 306 — Situação de Uso do SSWMobile. 1ª linha não vazia = cabeçalho literal; "9" sozinho = fim;
 * demais = 14 campos. Não altera o CT-e: alimenta a projeção "motorista por CT-e" do Romaneio.
 * origem: src/features/ssw/server/parse-306.server.ts (sistema atual)
 */
import { type Registro306 } from "@erp/shared/relatorios-ssw";

import { dataBR4, limpa, linhasDoArquivo, txt } from "./texto";
import { type Analise, diferencasDeCabecalho, type ErroDeLeitura, type LinhaLida } from "./tipos";

export const CABECALHO_LITERAL_306 =
  "PLACA;CTRC/COLETA;DATA;MOTORISTA;REMETENTE;UF/CIDADE ORIGEM;SETOR ORIGEM;DESTINATARIO;UF/CIDADE DESTINO;UNIDADE DESTINO;SETOR DESTINO;DATA PREVISAO ENTREGA;OCORRENCIA MOBILE;OCORRENCIA ATUAL";

const CABECALHO_306 = CABECALHO_LITERAL_306.split(";");

export type { Registro306 };

/** Só CTRC/COLETA no formato de CT-e ("CAP33214-5") tem número; coleta pura não. */
export function ehCtrcDo306(ctrcColeta: string | null): boolean {
  return /^[A-Z]{2,4}[0-9]/.test((ctrcColeta ?? "").trim());
}

export function ler306(conteudo: string): Analise<Registro306> {
  const registros: LinhaLida<Registro306>[] = [];
  const erros: ErroDeLeitura[] = [];
  let cabecalho: string | null = null;

  linhasDoArquivo(conteudo).forEach((linha, idx) => {
    if (linha.trim() === "") return;
    if (cabecalho === null) {
      cabecalho = linha.replace(/[\s\u00A0]+$/g, "");
      return;
    }
    const c = linha.split(";");
    if (limpa(c[0]) === "9" && c.slice(1).every((x) => limpa(x) === "")) return;
    if (c.length !== CABECALHO_306.length) {
      erros.push({
        linha: idx + 1,
        texto: linha,
        motivo: `esperado ${CABECALHO_306.length} campos, encontrado ${c.length}`,
      });
      return;
    }
    registros.push({
      linha: idx + 1,
      dados: {
        placa: txt(c[0]),
        ctrc_coleta: txt(c[1]),
        data: dataBR4(c[2]),
        motorista: txt(c[3]),
        remetente: txt(c[4]),
        uf_cidade_origem: txt(c[5]),
        setor_origem: txt(c[6]),
        destinatario: txt(c[7]),
        uf_cidade_destino: txt(c[8]),
        unidade_destino: txt(c[9]),
        setor_destino: txt(c[10]),
        data_previsao_entrega: dataBR4(c[11]),
        ocorrencia_mobile: txt(c[12]),
        ocorrencia_atual: txt(c[13]),
      },
    });
  });

  return { registros, erros, ...conferirCabecalhoLiteral(cabecalho, CABECALHO_LITERAL_306) };
}

/** 036 e 306: o cabeçalho é comparado ao texto literal; só espaço diferente também diverge. */
export function conferirCabecalhoLiteral(
  encontrado: string | null,
  literal: string,
): { cabecalhoDivergente: boolean; cabecalhoDiferencas: string[] } {
  if (encontrado === null) {
    return {
      cabecalhoDivergente: true,
      cabecalhoDiferencas: ["Linha de cabeçalho não encontrada no arquivo."],
    };
  }
  if (encontrado === literal) return { cabecalhoDivergente: false, cabecalhoDiferencas: [] };
  const diffs = diferencasDeCabecalho(encontrado.split(";"), literal.split(";"));
  if (diffs.length === 0) {
    diffs.push("Cabeçalho difere do esperado (diferença apenas de espaçamento).");
  }
  return { cabecalhoDivergente: true, cabecalhoDiferencas: diffs };
}
