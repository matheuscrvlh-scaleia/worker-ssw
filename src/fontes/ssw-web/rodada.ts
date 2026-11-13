/**
 * Uma rodada no SSW web para uma empresa: os relatórios do ciclo, com os nomes que a recepção da
 * ingestão reconhece (`<código>_<nome>[_<unidade>]_<aaaa-mm-dd>_<hhmm>.csv`, hora de Brasília).
 * A ordem é a do script antigo: os assíncronos (455 e 930, fila da opção 156) primeiro, para
 * processarem enquanto os diretos baixam. Falha de um relatório não derruba os outros.
 * origem: main() do ssw-download (ssw_download.py)
 */
import { FUSO_DO_NEGOCIO, relogioNoFuso } from "@erp/domain/core";

import { converterColetas050, csvDasColetas050, juntarColetas } from "./coletas-050";
import { type ConfiguracaoSswWeb } from "./parametros";

/** Sessão aberta no SSW web (login feito). A de verdade é o Chromium (`navegador.ts`). */
export interface SessaoSswWeb {
  /** Maior sequência da fila (opção 156) antes de disparar: o que vier acima é desta rodada. */
  marcaDaFila(): Promise<number>;
  /** Pede o 455 (Excel, complementares B e C) ou o 930 do dia (`ddmmaa`) para a fila. */
  dispararNaFila(opcao: "455" | "930", dia: string): Promise<void>;
  /** Baixa da fila os relatórios do usuário acima da marca; devolve só os que concluíram. */
  coletarDaFila(marca: number, opcoes: readonly string[]): Promise<Map<string, Uint8Array>>;
  baixar036(dia: string): Promise<Uint8Array>;
  baixar306(dia: string): Promise<Uint8Array>;
  baixar038(unidade: string): Promise<Uint8Array>;
  /** 050 impresso da filial; `""` quando o SSW responde "Sem movimento de coletas". */
  texto050(unidade: string, dia: string, busca: "cadastradas" | "coletadas"): Promise<string>;
  fechar(): Promise<void>;
}

export interface NavegadorSswWeb {
  /** Abre o navegador e faz o login; erro aqui é a rodada inteira perdida. */
  entrar(config: ConfiguracaoSswWeb): Promise<SessaoSswWeb>;
}

export interface ArquivoBaixado {
  nome: string;
  bytes: Uint8Array;
}

export interface RodadaSswWeb {
  arquivos: ArquivoBaixado[];
  /** `"<relatório>: <motivo>"` de cada um que falhou. */
  falhas: string[];
  /** Relatórios do 038 de unidade sem dado, descartados. */
  descartados: string[];
}

const NOMES_DA_FILA = { "455": "455_csv_e", "930": "930_ocorrencias" } as const;

function mensagemDe(erro: unknown): string {
  return (erro instanceof Error ? erro.message : String(erro)).split("\n")[0] ?? "";
}

/**
 * O 038 marca o tipo da linha no 1º campo (0 título, 1 cabeçalho, 2 dado, 9 rodapé): sem linha
 * `2;` o relatório está vazio. Vale só para o 038 (o 930 marca dado com `1`, o 306 não marca).
 */
export function temDadosNo038(bytes: Uint8Array): boolean {
  const texto = new TextDecoder("iso-8859-1").decode(bytes);
  return texto.split(/\r?\n/).some((l) => l.startsWith("2;"));
}

/**
 * `diaRetroativo` (`aaaa-mm-dd`): pede os relatórios desse dia em vez de hoje, com o carimbo
 * `<dia>_2359` (o do retroativo antigo: nunca colide com a grade :00/:30) e sem o 038, que é a
 * foto dos pendentes no instante e não um relatório do dia.
 */
export async function rodadaSswWeb(
  navegador: NavegadorSswWeb,
  config: ConfiguracaoSswWeb,
  agora: Date,
  diaRetroativo: string | null = null,
): Promise<RodadaSswWeb> {
  const relogio = relogioNoFuso(agora, FUSO_DO_NEGOCIO);
  const dd = (n: number) => String(n).padStart(2, "0");
  const [ano, mes, dia] = diaRetroativo
    ? diaRetroativo.split("-").map(Number)
    : [relogio.getUTCFullYear(), relogio.getUTCMonth() + 1, relogio.getUTCDate()];
  if (ano === undefined || mes === undefined || dia === undefined) {
    throw new Error(`Dia retroativo inválido: ${diaRetroativo ?? ""}`);
  }
  const hoje = `${dd(dia)}${dd(mes)}${dd(ano % 100)}`; // ddmmaa, o formato do SSW
  const hora = diaRetroativo
    ? "2359"
    : `${dd(relogio.getUTCHours())}${dd(relogio.getUTCMinutes())}`;
  const carimbo = `${ano}-${dd(mes)}-${dd(dia)}_${hora}`;
  const nome = (base: string) => `${base}_${carimbo}.csv`;
  const unidades038 = diaRetroativo ? [] : config.unidades038;
  const unidades038SoComDados = diaRetroativo ? [] : config.unidades038SoComDados;

  const arquivos: ArquivoBaixado[] = [];
  const falhas: string[] = [];
  const descartados: string[] = [];
  const tentar = async <T>(rotulo: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (erro) {
      falhas.push(`${rotulo}: ${mensagemDe(erro)}`);
      return null;
    }
  };

  const sessao = await navegador.entrar(config);
  try {
    const marca = await tentar("156 (marca da fila)", () => sessao.marcaDaFila());
    const disparados: ("455" | "930")[] = [];
    if (marca !== null) {
      for (const opcao of ["455", "930"] as const) {
        const ok = await tentar(`${opcao} (disparo)`, async () => {
          await sessao.dispararNaFila(opcao, hoje);
          return true;
        });
        if (ok) disparados.push(opcao);
      }
    }

    await tentar("036", async () => {
      arquivos.push({ nome: nome("036_romaneios"), bytes: await sessao.baixar036(hoje) });
    });
    await tentar("306", async () => {
      arquivos.push({ nome: nome("306_sswmobile"), bytes: await sessao.baixar306(hoje) });
    });
    for (const unidade of unidades038) {
      await tentar(`038/${unidade}`, async () => {
        const bytes = await sessao.baixar038(unidade);
        arquivos.push({ nome: nome(`038_pendentes_${unidade}`), bytes });
      });
    }

    if (marca !== null && disparados.length > 0) {
      const prontos = await tentar("156 (coleta da fila)", () =>
        sessao.coletarDaFila(marca, disparados),
      );
      if (prontos !== null) {
        for (const opcao of disparados) {
          const bytes = prontos.get(opcao);
          if (bytes === undefined) falhas.push(`${opcao}: não liberou na fila a tempo`);
          else arquivos.push({ nome: nome(NOMES_DA_FILA[opcao]), bytes });
        }
      }
    }

    // Unidades que ainda não operam: o arquivo vazio é descartado (seriam dezenas por dia).
    for (const unidade of unidades038SoComDados) {
      await tentar(`038/${unidade}`, async () => {
        const bytes = await sessao.baixar038(unidade);
        if (temDadosNo038(bytes)) arquivos.push({ nome: nome(`038_pendentes_${unidade}`), bytes });
        else descartados.push(`038/${unidade}`);
      });
    }

    // 050: todas as filiais num arquivo só. Filial que falha derruba o 050 inteiro: um arquivo
    // sem uma delas pareceria completo do outro lado.
    if (config.unidades050.length > 0) {
      await tentar("050", async () => {
        const ref = { ano, mes, dia };
        const listas = [];
        for (const unidade of config.unidades050) {
          for (const busca of ["cadastradas", "coletadas"] as const) {
            listas.push(converterColetas050(await sessao.texto050(unidade, hoje, busca), ref));
          }
        }
        arquivos.push({
          nome: nome("050_coletas"),
          bytes: csvDasColetas050(juntarColetas(listas)),
        });
      });
    }
  } finally {
    await sessao.fechar().catch(() => undefined);
  }
  return { arquivos, falhas, descartados };
}
