/**
 * Job `baixar-relatorios-ssw` (ADR 0013 do ERP): baixa os relatórios da empresa no SSW web e os
 * entrega à mesma recepção do `sincronizar-ftp` (mesmos nomes, mesmo ciclo), sem SFTP no
 * caminho; depois roda o ciclo de aplicação, como o FTP faz.
 */
import { dividirCsv, MAX_PARTE_BYTES, nomeParte } from "../../fontes/relatorios";
import { type DependenciasDoCiclo, rodarCiclos } from "./ciclo";
import { sha256 } from "./linhas";
import { receberArquivo } from "./receber";

/** Uma rodada leva de 3 a 10 min (a fila da 156 espera até 5); a trava cobre com folga. */
export const TRAVA_DO_SSW_WEB_MS = 20 * 60_000;
export const travaDoSswWeb = (empresaId: string) => `ssw-web:${empresaId}`;

/** O que a rodada no SSW web devolve (`fontes/ssw-web/rodada.ts`). */
export interface BaixadosDoSswWeb {
  arquivos: { nome: string; bytes: Uint8Array }[];
  falhas: string[];
  descartados: string[];
}

export interface DependenciasDoSswWeb extends DependenciasDoCiclo {
  baixar: () => Promise<BaixadosDoSswWeb>;
}

export interface ResultadoDoSswWeb {
  status: "ok" | "parcial" | "ja_rodando";
  mensagem: string;
  importados: number;
  /** Já importados antes (mesmo nome e conteúdo). */
  repetidos: number;
  falhas: string[];
}

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Erro (o job falha e aparece no Diagnóstico SSW) quando nada chegou à ingestão; `parcial` quando
 * parte falhou e o resto foi importado.
 */
export async function baixarRelatoriosSsw(deps: DependenciasDoSswWeb): Promise<ResultadoDoSswWeb> {
  const chave = travaDoSswWeb(deps.empresaId);
  const token = await deps.travas.adquirir(chave, TRAVA_DO_SSW_WEB_MS);
  if (token === null) {
    return {
      status: "ja_rodando",
      mensagem: "Download do SSW web já em andamento.",
      importados: 0,
      repetidos: 0,
      falhas: [],
    };
  }
  try {
    const baixados = await deps.baixar();
    const falhas = [...baixados.falhas];
    let importados = 0;
    let repetidos = 0;
    const mtime = deps.agora().getTime();
    for (const arquivo of baixados.arquivos) {
      // Arquivo grande (o 455 passa de 30 MB) entra em partes, como no FTP.
      const partes =
        arquivo.bytes.length > MAX_PARTE_BYTES
          ? dividirCsv(arquivo.bytes).map((bytes, i) => ({
              nome: nomeParte(arquivo.nome, i + 1),
              bytes,
            }))
          : [arquivo];
      for (const parte of partes) {
        try {
          const r = await receberArquivo(deps, {
            nome: parte.nome,
            bytes: parte.bytes,
            sha256: sha256(parte.bytes),
            tamanho: parte.bytes.length,
            mtime,
          });
          if (!r.ok) falhas.push(`${parte.nome}: ${r.mensagem}`);
          else if (r.status === "ignorado") repetidos++;
          else importados++;
        } catch (e) {
          falhas.push(`${parte.nome}: ${mensagemDe(e)}`);
        }
      }
    }
    if (importados + repetidos > 0) {
      try {
        await rodarCiclos(deps);
      } catch (e) {
        falhas.push(`ciclo de aplicação: ${mensagemDe(e)}`);
      }
    }
    if (importados + repetidos === 0) {
      throw new Error(`Nenhum relatório do SSW web importado. ${falhas.join("; ")}`.trim());
    }
    const resumo = `${importados} importado(s), ${repetidos} repetido(s)`;
    return falhas.length === 0
      ? { status: "ok", mensagem: resumo, importados, repetidos, falhas }
      : {
          status: "parcial",
          mensagem: `${resumo}, ${falhas.length} falha(s)`,
          importados,
          repetidos,
          falhas,
        };
  } finally {
    await deps.travas.liberar(chave, token);
  }
}
