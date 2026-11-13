/**
 * 038 — CTRCs Pendentes de Entrega (um arquivo por unidade). `0`/`9` ignoradas, `1` = cabeçalho,
 * `2` = dado com 17 campos (`split(";")`, sem aspas). Prazo "31/12/2050" = sem prazo definido.
 * origem: src/features/ssw/server/parse-038.server.ts (sistema atual)
 */
import { type Registro038 } from "@erp/shared/ssw-reports";

import { dataBR4, linhasDoArquivo, numPonto, truncar } from "./texto";
import { type Analise, diferencasDeCabecalho, type ErroDeLeitura, type LinhaLida } from "./tipos";

export const CABECALHO_038 = [
  "CTRC",
  "NOTA FISCAL",
  "REMETENTE",
  "DESTINATARIO",
  "ENDERECO",
  "CIDADE",
  "BAIRRO",
  "CEP",
  "SETOR",
  "VALOR MERCADORIA",
  "QUANTIDADE VOLUMES",
  "PESO",
  "PRAZO ENTREGA",
  "ATRASO",
  "ULTIMA OCORRENCIA",
  "LOCALIZACAO",
] as const;

export const PRAZO_SEM_DEFINICAO = "31/12/2050";

export type { Registro038 };

/** O 038 usa `trim` simples (sem tratar o espaço não-quebrável), como o leitor atual. */
function texto(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length ? s : null;
}

export function ler038(conteudo: string): Analise<Registro038> {
  const registros: LinhaLida<Registro038>[] = [];
  const erros: ErroDeLeitura[] = [];
  // `as`: o forEach muda a variável; sem ele o TS a estreita para o valor inicial.
  let cabecalho = null as string[] | null;

  linhasDoArquivo(conteudo).forEach((linha, idx) => {
    if (!linha.trim()) return;
    const tipo = linha.trim().charAt(0);
    if (tipo === "0" || tipo === "9") return;
    const c = linha.split(";");
    if (tipo === "1") {
      cabecalho ??= c.slice(1).map((x) => x.trim());
      return;
    }
    if (tipo !== "2") {
      erros.push({ linha: idx + 1, texto: linha, motivo: "tipo de linha desconhecido" });
      return;
    }
    if (c.length !== 17) {
      erros.push({
        linha: idx + 1,
        texto: linha,
        motivo: `esperado 17 campos, encontrado ${c.length}`,
      });
      return;
    }
    const semPrazo = (c[13] ?? "").trim() === PRAZO_SEM_DEFINICAO;
    registros.push({
      linha: idx + 1,
      dados: {
        sem_prazo_definido: semPrazo,
        ctrc: texto(c[1]),
        nota_fiscal: texto(c[2]),
        remetente: texto(c[3]),
        destinatario: texto(c[4]),
        endereco: texto(c[5]),
        cidade: texto(c[6]),
        bairro: texto(c[7]),
        cep: texto(c[8]),
        setor: texto(c[9]),
        valor_mercadoria: numPonto(c[10]),
        quantidade_volumes: truncar(numPonto(c[11])),
        peso: numPonto(c[12]),
        prazo_entrega: semPrazo ? null : dataBR4(c[13]),
        atraso: semPrazo ? null : truncar(numPonto(c[14])),
        ultima_ocorrencia: texto(c[15]),
        localizacao: texto(c[16]),
      },
    });
  });

  const diferencas = cabecalho
    ? diferencasDeCabecalho(cabecalho, CABECALHO_038, "Quantidade de colunas do cabeçalho")
    : ['Linha de cabeçalho (tipo "1") não encontrada no arquivo.'];
  return {
    registros,
    erros,
    cabecalhoDivergente: diferencas.length > 0,
    cabecalhoDiferencas: diferencas,
  };
}
