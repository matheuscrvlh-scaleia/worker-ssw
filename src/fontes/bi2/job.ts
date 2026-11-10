/**
 * Job `bi2-0017`: baixa o 0017 de cada data do ciclo, completa entrega e previsão dos CT-e
 * encerrados (pelo núcleo), guarda o bruto e registra a sincronização. O BI2 só fica com o 0017
 * (Q41 do dono: os pausados e o backfill não foram portados).
 * Especificação: docs/regras/06-ingestao.md §3.14, §3.15.
 */
import {
  datasDoCiclo0017,
  entregaEPrevisaoDoBi2,
  type Linha0017,
  MODOS_DO_0017,
  prazoAjustadoDepoisDaEntrega,
  ultimaPorCte,
  vazioQuandoNaoEncontrado,
} from "@erp/dominio/ingestao/bi2-0017";
import { hojeSp } from "@erp/dominio/nucleo";
import { ehDataIso } from "@erp/shared/datas";
import { filaDoJob } from "@erp/shared/ingestao";
import { z } from "@erp/shared/zod";

import { regravarCte, type RepositorioCteNucleo } from "../../aplicacao/casos-de-uso";
import { type CteDaIngestao } from "../../aplicacao/regras";
import { definirJob, type RepositoriosDoWorker } from "../../jobs/registro";
import { type Cofre, parametroTexto, segredoDa } from "../comum/integracao";
import { type Buscar, buscarRelatorioBi2, lerCsvBi2, urlDoRelatorio } from "./cliente";
import { CODIGO_DO_0017, comAutorizacao, lerLinhas0017 } from "./relatorio-0017";

/** Linhas por transação de aplicação e por gravação do bruto (como hoje). */
const LOTE_DE_APLICACAO = 500;
const LOTE_DO_BRUTO = 300;

export interface SincronizacaoNova {
  codigoRelatorio: string;
  dataAlvo: string;
  dataFechamentoSsw: string;
  modo: string;
  status: "ok" | "erro" | "vazio";
  totalLinhas: number;
  atualizados: number;
  erro: string | null;
  iniciadoEm: Date;
  finalizadoEm: Date;
}

export interface RepositorioBi2 {
  /** CT-e da empresa com estes números (qualquer sigla: o BI2 casa por número + emissão). */
  ctesPorNumeros(numeros: readonly string[]): Promise<CteDaIngestao[]>;
  gravarBruto(
    codigoRelatorio: string,
    dataAlvo: string,
    linhas: readonly { numero: string; payload: Record<string, string> }[],
    agora: Date,
  ): Promise<void>;
  registrarSincronizacao(s: SincronizacaoNova): Promise<void>;
}

export const dadosDoBi2_0017 = z.object({
  empresaId: z.uuid(),
  modo: z.enum(MODOS_DO_0017).default("manual"),
  data: z.string().refine(ehDataIso, "data inválida").optional(),
  lookback: z.number().int().optional(),
});

export interface DependenciasDoBi2 {
  buscar: Buscar;
  cofre: Cofre;
}

type Executar = <T>(fn: (r: RepositoriosDoWorker) => Promise<T>) => Promise<T>;

export function criarJobBi2_0017(deps: DependenciasDoBi2) {
  return definirJob({
    nome: "bi2-0017",
    fila: filaDoJob("bi2-0017"),
    escopo: "empresa",
    dados: dadosDoBi2_0017,
    agendamento: null,
    async processar({ executar, agora, log }, dados) {
      const integracao = await executar(({ integracoes }) =>
        integracoes.ler(dados.empresaId, "ssw_bi2"),
      );
      if (!integracao?.ativo) {
        log.info("integração ssw_bi2 desligada: nada a fazer");
        return { ok: true, ignorado: true };
      }
      const token = segredoDa(deps.cofre, dados.empresaId, "ssw_bi2", integracao);
      const dominio =
        parametroTexto(integracao.parametros, "dominio") || integracao.dominioSswDaEmpresa;
      const datas = datasDoCiclo0017({
        modo: dados.modo,
        data: dados.data ?? null,
        lookback: dados.lookback ?? null,
        hoje: hojeSp(agora()),
      });
      const resultados: SincronizacaoNova[] = [];
      for (const data of datas) {
        const r = await sincronizarData(
          { executar, agora, buscar: deps.buscar },
          {
            data,
            modo: dados.modo,
            token,
            dominio,
          },
        );
        await executar(({ bi2 }) => bi2.registrarSincronizacao(r));
        log.info({ data, status: r.status, linhas: r.totalLinhas }, "bi2 0017");
        resultados.push(r);
      }
      return { ok: resultados[0]?.status !== "erro", resultados };
    },
  });
}

/** Uma data: baixa, aplica em lotes (erro de lote não para os outros) e guarda o bruto. */
export async function sincronizarData(
  ctx: { executar: Executar; agora: () => Date; buscar: Buscar },
  entrada: { data: string; modo: string; token: string | null; dominio: string | null },
): Promise<SincronizacaoNova> {
  const iniciadoEm = ctx.agora();
  const fim = (
    status: SincronizacaoNova["status"],
    resto: Partial<Pick<SincronizacaoNova, "totalLinhas" | "atualizados" | "erro">> = {},
  ): SincronizacaoNova => ({
    codigoRelatorio: CODIGO_DO_0017,
    dataAlvo: entrada.data,
    dataFechamentoSsw: entrada.data,
    modo: entrada.modo,
    status,
    totalLinhas: resto.totalLinhas ?? 0,
    atualizados: resto.atualizados ?? 0,
    erro: resto.erro ?? null,
    iniciadoEm,
    finalizadoEm: ctx.agora(),
  });

  if (!entrada.token)
    return fim("erro", { erro: "Token do BI2 não configurado para esta empresa" });
  let url: string;
  try {
    url = urlDoRelatorio(entrada.dominio ?? "", "cliente", CODIGO_DO_0017, entrada.data);
  } catch (erro) {
    return fim("erro", { erro: mensagem(erro) });
  }
  const resposta = await buscarRelatorioBi2(ctx.buscar, { url, token: entrada.token });
  if (resposta.tipo === "falha") return fim("erro", { erro: resposta.mensagem });
  if (resposta.tipo === "http") {
    if (resposta.status === 404 && vazioQuandoNaoEncontrado(entrada.data, hojeSp(ctx.agora()))) {
      return fim("vazio");
    }
    return fim("erro", { erro: `HTTP ${resposta.status}: ${resposta.corpo.slice(0, 500)}` });
  }
  const csv = lerCsvBi2(resposta.texto);
  if (csv.vazio) return fim("vazio");

  const lidas = lerLinhas0017(csv);
  const validas = comAutorizacao(lidas);
  const ignoradas = lidas.length - validas.length;
  const erros: string[] = [];
  let casados = 0;
  for (let i = 0; i < validas.length; i += LOTE_DE_APLICACAO) {
    const lote = validas.slice(i, i + LOTE_DE_APLICACAO);
    try {
      const r = await ctx.executar(({ bi2, cteNucleo }) =>
        aplicarLote0017(bi2, cteNucleo, lote, ctx.agora()),
      );
      casados += r.casados;
    } catch (erro) {
      erros.push(mensagem(erro));
    }
  }
  for (let i = 0; i < lidas.length; i += LOTE_DO_BRUTO) {
    const bloco = lidas
      .slice(i, i + LOTE_DO_BRUTO)
      .map((l) => ({ numero: l.numero, payload: l.bruto }));
    await ctx.executar(({ bi2 }) =>
      bi2.gravarBruto(CODIGO_DO_0017, entrada.data, bloco, ctx.agora()),
    );
  }
  const erro =
    erros.slice(0, 3).join(" | ").slice(0, 500) ||
    (ignoradas > 0 ? `ignorados_sem_autorizacao=${ignoradas}` : null);
  return fim(erros.length > 0 && casados === 0 ? "erro" : "ok", {
    totalLinhas: lidas.length,
    atualizados: casados,
    erro,
  });
}

/**
 * Um lote numa transação. Passo 1 (fonte `bi2`) e depois o passo 2 (fonte
 * `bi2_0017_prazo_entregue`) sobre o CT-e já atualizado; o núcleo descarta CT-e em andamento.
 * origem: bi2_0017_aplicar_lote (sistema atual)
 */
export async function aplicarLote0017(
  bi2: RepositorioBi2,
  repo: RepositorioCteNucleo,
  linhas: readonly Linha0017[],
  agora: Date,
): Promise<{ casados: number; alterados: number }> {
  const unicas = ultimaPorCte(linhas);
  const candidatos = await bi2.ctesPorNumeros([...new Set(unicas.map((l) => l.numero))]);
  const pares = unicas.flatMap((linha) =>
    candidatos
      .filter((c) => c.numero === linha.numero && c.dataEmissao === linha.dataEmissao)
      .map((cte) => ({ linha, cte })),
  );
  if (pares.length === 0) return { casados: 0, alterados: 0 };
  const cad = await repo.cadastrosDoNucleo();
  const ocorrencias = await repo.ocorrenciasDosCtes(pares.map((p) => p.cte.id));
  let alterados = 0;
  for (const { linha, cte } of pares) {
    const doCte = ocorrencias.get(cte.id) ?? [];
    let atual = cte;
    const passo1 = entregaEPrevisaoDoBi2(atual, linha);
    if (passo1) {
      const r = await regravarCte(repo, cad, atual, passo1, doCte, agora, { fonte: "bi2" });
      if (r.tipo === "gravado") {
        atual = r.cte;
        alterados++;
      }
    }
    const passo2 = prazoAjustadoDepoisDaEntrega(atual, linha);
    if (passo2) {
      const r = await regravarCte(repo, cad, atual, passo2, doCte, agora, {
        fonte: "bi2_0017_prazo_entregue",
      });
      if (r.tipo === "gravado" && atual === cte) alterados++;
    }
  }
  return { casados: pares.length, alterados };
}

function mensagem(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}
