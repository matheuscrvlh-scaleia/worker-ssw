/**
 * Recepção de um arquivo de relatório (FTP ou rota `ftp-relatorio-import`) e importação manual
 * pela tela. Spec 06 §3.2 e §3.3; Q38/Q39 do dono (050 registrado em `ingestao_arquivos`).
 * origem: src/routes/api/public/ftp-relatorio-import.ts + ciclo.server.ts (sistema atual)
 */
import { randomUUID } from "node:crypto";

import { ErroDeNegocio } from "@erp/dominio/erros";
import { JOB_COLETAS_050 } from "@erp/shared/ingestao";

import {
  type AnaliseDoRelatorio,
  detectarRelatorioBytes,
  lerRelatorio,
  pareceRelatorio050,
  type Relatorio,
} from "../../fontes/relatorios";
import { linhasParaGravar } from "./linhas";
import {
  type Enfileirador,
  type ErroNovo,
  type RepositorioIngestao,
  type Transacional,
} from "./portas";

/** Relatório que guarda a unidade do arquivo (o 038 vem um por unidade). */
const POR_UNIDADE: ReadonlySet<string> = new Set(["038"]);

export interface ArquivoRecebido {
  nome: string;
  bytes: Uint8Array;
  sha256: string;
  tamanho: number;
  mtime: number;
}

export type ResultadoDaRecepcao =
  | { ok: true; status: "ignorado"; mensagem: string; gravados: number }
  | { ok: true; status: "importado"; relatorio: Relatorio; gravados: number }
  | { ok: true; status: "coletas"; mensagem: string }
  | { ok: false; status: "erro"; mensagem: string };

export interface DependenciasDaRecepcao {
  empresaId: string;
  executar: Transacional;
  enfileirador: Enfileirador;
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errosDaAnalise(lido: AnaliseDoRelatorio, arquivo: string | null): ErroNovo[] {
  return lido.analise.erros.map((e) => ({
    relatorio: lido.relatorio,
    etapa: "gravacao",
    arquivoOrigem: arquivo,
    numeroLinha: e.linha,
    linhaBruta: e.texto,
    motivo: e.motivo,
  }));
}

/** Grava as linhas lidas e os erros de leitura num lote novo. */
async function gravarNaStaging(
  repo: RepositorioIngestao,
  lido: AnaliseDoRelatorio,
  loteId: string,
  arquivoId: string | null,
  arquivo: string | null,
): Promise<number> {
  const gravados = await repo.gravarLinhas(
    lido.relatorio,
    loteId,
    arquivoId,
    linhasParaGravar(lido),
  );
  await repo.gravarErros(loteId, errosDaAnalise(lido, arquivo));
  return gravados;
}

/**
 * Recebe um arquivo do FTP. Linhas, arquivo `importado` e ciclo vão na mesma transação: o status
 * do arquivo é o "commit" do lote, e uma tentativa que falha não deixa linha parcial.
 */
export async function receberArquivo(
  deps: DependenciasDaRecepcao,
  arquivo: ArquivoRecebido,
): Promise<ResultadoDaRecepcao> {
  const { nome, bytes, sha256, tamanho, mtime } = arquivo;
  const latin1 = new TextDecoder("iso-8859-1").decode(bytes);
  const visto = await deps.executar((r) => r.arquivoPorNome(nome));
  if (visto?.status === "importado" && visto.sha256 === sha256) {
    return {
      ok: true,
      status: "ignorado",
      mensagem: "arquivo já importado anteriormente",
      gravados: visto.linhas,
    };
  }

  if (pareceRelatorio050(latin1)) {
    await deps.enfileirador.enfileirar(JOB_COLETAS_050.fila, JOB_COLETAS_050.nome, {
      empresaId: deps.empresaId,
      nome,
      conteudo: latin1,
    });
    await deps.executar((r) =>
      r.registrarArquivo({
        nomeArquivo: nome,
        cicloChave: null,
        relatorio: "050",
        unidade: null,
        tamanho,
        mtime: Math.trunc(mtime),
        sha256,
        status: "importado",
        linhas: 0,
        mensagem: "enviado para a importação de coletas",
        loteId: null,
      }),
    );
    return { ok: true, status: "coletas", mensagem: "Relatório 050 enviado para as coletas." };
  }

  const det = detectarRelatorioBytes(nome, bytes);
  const ciclo = det.cicloChave ?? "sem-carimbo";
  const base = { nomeArquivo: nome, cicloChave: ciclo, tamanho, mtime: Math.trunc(mtime), sha256 };
  const registrarErro = (relatorio: string | null, motivo: string, loteId: string | null) =>
    deps.executar(async (r) => {
      await r.registrarArquivo({
        ...base,
        relatorio,
        unidade: null,
        status: "erro",
        linhas: 0,
        mensagem: motivo,
        loteId,
      });
      await r.garantirCiclo(ciclo);
      await r.mudarCiclo(ciclo, { status: "erro", motivo: `${nome}: ${motivo}` });
    });

  const lido = det.confirmado;
  if (!lido) {
    const motivo = det.motivo ?? "Relatório não reconhecido.";
    await registrarErro(det.relatorio, motivo, null);
    return { ok: false, status: "erro", mensagem: motivo };
  }
  const unidade = det.unidade && POR_UNIDADE.has(lido.relatorio) ? det.unidade : null;
  const loteId = randomUUID();
  try {
    const gravados = await deps.executar(async (r) => {
      await r.garantirCiclo(ciclo);
      await r.registrarArquivo({
        ...base,
        relatorio: lido.relatorio,
        unidade,
        status: "importando",
        linhas: 0,
        mensagem: null,
        loteId,
      });
      const registrado = await r.arquivoPorNome(nome);
      const n = await gravarNaStaging(r, lido, loteId, registrado?.id ?? null, nome);
      await r.registrarArquivo({
        ...base,
        relatorio: lido.relatorio,
        unidade,
        status: "importado",
        linhas: n,
        mensagem: det.divergenciaNomeCabecalho
          ? `nome sugeria ${det.relatorio ?? "?"}, cabeçalho confirmou ${lido.relatorio}`
          : null,
        loteId,
      });
      await r.mudarCiclo(ciclo, {
        status: "importando",
        somarArquivos: 1,
        somarLinhas: n,
        tocarUltimoArquivo: true,
      });
      return n;
    });
    return { ok: true, status: "importado", relatorio: lido.relatorio, gravados };
  } catch (e) {
    await registrarErro(lido.relatorio, mensagem(e), loteId);
    return { ok: false, status: "erro", mensagem: mensagem(e) };
  }
}

/**
 * Importação manual pela tela (Admin › Importação SSW): grava o relatório num lote sem ciclo; as
 * linhas entram na próxima aplicação. Cabeçalho divergente só passa com a confirmação da tela.
 */
export async function importarRelatorioManual(
  executar: Transacional,
  entrada: {
    relatorio: Relatorio;
    conteudo: string;
    nome: string | null;
    aceitarDivergencia: boolean;
  },
): Promise<{ loteId: string; gravados: number; erros: number }> {
  const lido = lerRelatorio(entrada.relatorio, entrada.conteudo);
  if (lido.analise.cabecalhoDivergente && !entrada.aceitarDivergencia) {
    throw new ErroDeNegocio(
      "ENTRADA_INVALIDA",
      `Cabeçalho do relatório ${entrada.relatorio} divergente do esperado — arquivo não importado. Confira o arquivo ou marque a confirmação para gravar mesmo assim.`,
    );
  }
  if (lido.analise.registros.length === 0) {
    throw new ErroDeNegocio("ENTRADA_INVALIDA", "Nenhuma linha válida para gravar.");
  }
  const loteId = randomUUID();
  const gravados = await executar((r) => gravarNaStaging(r, lido, loteId, null, entrada.nome));
  return { loteId, gravados, erros: lido.analise.erros.length };
}
