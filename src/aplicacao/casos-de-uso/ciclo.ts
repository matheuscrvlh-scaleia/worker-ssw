/**
 * Ciclo automático de aplicação (job `aplicar-ciclos`, todo minuto), romaneio do CT-e pelo 036,
 * partes do CT-e pelo 455 e descarte/retomada do ciclo pela tela. Spec 06 §3.6.2, §3.9 e §3.13;
 * Q38 b (036 direto da staging), Q51 b (descartar apaga todas as linhas do ciclo, 455 CSV junto).
 * origem: ciclo.server.ts, aplicar_036_romaneio, aplicar_partes_455 (sistema atual)
 */
import { ErroDeNegocio } from "@erp/domain/errors";
import { type LinhasDescartadas } from "@erp/domain/manifest/projections";
import { JOB_PROJECOES_ROMANEIO } from "@erp/shared/ingestion";
import { registro036 } from "@erp/shared/ssw-reports";

import { type Registro036, type Registro455Csv } from "../../fontes/relatorios";
import {
  avaliarCiclo,
  camposDo036,
  type CamposDoCte,
  type ChaveCte,
  chaveDoCte,
  type CteDaIngestao,
  JANELA_PARTES_455_MS,
  linha036QueVale,
  type LinhaGuardada,
  partesDo455,
} from "../regras";
import {
  aplicarBloco,
  avisarProjecoes,
  type DependenciasDaAplicacao,
  prepararFila,
} from "./aplicar";
import { regravarCte } from "./gravar-cte";
import {
  type CicloRegistrado,
  type FilaDeAplicacao,
  type LinhaApagada,
  type LinhaDaChave,
  type RepositorioIngestao,
  type Travas,
} from "./portas";

export const BLOCO = 4000;
export const ORCAMENTO_CICLO_MS = 40_000;
export const ORCAMENTO_RODADA_MS = 60_000;
export const LEASE_DO_CICLO_MS = 180_000;
export const travaDoCiclo = (empresaId: string) => `ssw_aplicar_ciclo:${empresaId}`;
/** Bloco do repasse: pequeno, para o ciclo dos dados novos esperar pouco pela trava. */
export const BLOCO_DO_REPASSE = 500;

export interface DependenciasDoCiclo extends DependenciasDaAplicacao {
  travas: Travas;
}

function porChave(linhas: readonly LinhaDaChave[]): Map<string, LinhaDaChave[]> {
  const m = new Map<string, LinhaDaChave[]>();
  for (const l of linhas) m.set(chaveDoCte(l), [...(m.get(chaveDoCte(l)) ?? []), l]);
  return m;
}

const comoGuardadas = <R>(linhas: readonly LinhaDaChave[]): LinhaGuardada<R>[] =>
  linhas.map((l) => ({
    id: l.id,
    loteId: l.loteId,
    importadoEm: l.importadoEm,
    dados: l.dados as R,
  }));

/**
 * Aplica `calcular` aos CT-e das chaves, numa transação: carrega cadastros e ocorrências, grava
 * pelo núcleo. Devolve as chaves que mudaram.
 */
async function regravarChaves(
  r: RepositorioIngestao,
  chaves: readonly ChaveCte[],
  agora: Date,
  calcular: (cte: CteDaIngestao, chave: string) => Promise<CamposDoCte | null> | CamposDoCte | null,
): Promise<string[]> {
  const ctes = await r.ctesDasChaves(chaves);
  if (ctes.length === 0) return [];
  const cad = await r.cadastrosDoNucleo();
  const ocorrencias = await r.ocorrenciasDosCtes(ctes.map((c) => c.id));
  const mudaram: string[] = [];
  for (const cte of ctes) {
    const campos = await calcular(cte, chaveDoCte(cte));
    if (!campos || Object.keys(campos).length === 0) continue;
    const res = await regravarCte(r, cad, cte, campos, ocorrencias.get(cte.id) ?? [], agora);
    if (res.tipo === "gravado") mudaram.push(chaveDoCte(cte));
  }
  return mudaram;
}

/**
 * Romaneio do CT-e pelo 036 (direto da staging — Q38 b) e linhas do 306 (só as projeções leem).
 * Processa as chaves com linha pendente; na simulação só conta o primeiro bloco.
 */
export async function aplicar036(
  deps: DependenciasDaAplicacao,
  dryRun: boolean,
): Promise<{ alterados: number }> {
  let alterados = 0;
  for (;;) {
    const res = await deps.executar(async (r) => {
      const chaves = await r.chavesPendentes(["036"], BLOCO);
      if (chaves.length === 0) return null;
      const grupos = porChave(await r.linhasDasChaves("036", chaves));
      const calcular = (cte: CteDaIngestao, k: string) => {
        const v = linha036QueVale(comoGuardadas<Registro036>(grupos.get(k) ?? []));
        return v ? camposDo036(cte, v.dados) : null;
      };
      if (dryRun) {
        const ctes = await r.ctesDasChaves(chaves);
        return {
          chaves,
          mudaram: ctes
            .filter((c) => Object.keys(calcular(c, chaveDoCte(c)) ?? {}).length)
            .map(chaveDoCte),
        };
      }
      const mudaram = await regravarChaves(r, chaves, deps.agora(), calcular);
      await r.marcarAplicadas(["036"], chaves, deps.agora());
      return { chaves, mudaram };
    });
    if (!res) break;
    alterados += res.mudaram.length;
    if (dryRun) break;
    await avisarProjecoes(deps.enfileirador, deps.empresaId, res.chaves.map(chaveDoCte));
  }
  if (!dryRun) {
    for (;;) {
      const chaves = await deps.executar(async (r) => {
        const c = await r.chavesPendentes(["306"], BLOCO);
        await r.marcarAplicadas(["306"], c, deps.agora());
        return c;
      });
      if (chaves.length === 0) break;
      await avisarProjecoes(deps.enfileirador, deps.empresaId, chaves.map(chaveDoCte));
    }
  }
  return { alterados };
}

export interface TotaisDasPartes455 {
  casados: number;
  alterados: number;
  remetente: number;
  destinatario: number;
  parceiro: number;
  tde: number;
  comprovante: number;
  setor: number;
  chave: number;
  placaColeta: number;
  unidadeOrigem: number;
}

/** Partes do CT-e pelo 455 das últimas 48 h (fim de cada ciclo; erro não derruba o ciclo). */
export async function aplicarPartes455(deps: DependenciasDaAplicacao): Promise<TotaisDasPartes455> {
  const t: TotaisDasPartes455 = {
    casados: 0,
    alterados: 0,
    remetente: 0,
    destinatario: 0,
    parceiro: 0,
    tde: 0,
    comprovante: 0,
    setor: 0,
    chave: 0,
    placaColeta: 0,
    unidadeOrigem: 0,
  };
  const desde = new Date(deps.agora().getTime() - JANELA_PARTES_455_MS);
  const todas = await deps.executar((r) => r.chavesDesde("455csv", desde));
  for (let i = 0; i < todas.length; i += BLOCO) {
    const chaves = todas.slice(i, i + BLOCO);
    const mudaram = await deps.executar(async (r) => {
      const grupos = porChave(await r.linhasDasChaves("455csv", chaves));
      const proprios = new Set((await r.cadastrosDoNucleo()).cnpjsProprios);
      const chavesUsadas = new Set<string>();
      return regravarChaves(r, chaves, deps.agora(), async (cte, k) => {
        const p = partesDo455(cte, comoGuardadas<Registro455Csv>(grupos.get(k) ?? []), proprios);
        if (!p) return null;
        t.casados++;
        const campos: CamposDoCte = { ...p.campos };
        if (p.chave !== null && p.chave !== cte.chave && !chavesUsadas.has(p.chave)) {
          const dono = await r.cteDaChave(p.chave);
          if (dono === null) {
            campos.chave = p.chave;
            chavesUsadas.add(p.chave);
            t.chave++;
          }
        }
        for (const [nome, mudou] of Object.entries(p.mudou)) {
          if (mudou) t[nome as keyof typeof p.mudou]++;
        }
        return campos;
      });
    });
    t.alterados += mudaram.length;
    await avisarProjecoes(deps.enfileirador, deps.empresaId, mudaram);
  }
  return t;
}

type Totais = Record<string, unknown> & {
  _blocos?: number;
  _fila_pronta?: boolean;
  _fila_iniciada_em?: string;
  _processados?: number;
};

const num = (v: unknown) => (typeof v === "number" ? v : 0);

export type StatusDoCiclo = "nada_a_fazer" | "aguardando" | "aplicado" | "erro";

/** Aplica um ciclo, retomável pelo estado em `totais`. Não chama a aplicação com a fila vazia. */
export async function aplicarCiclo(
  deps: DependenciasDaAplicacao,
  ciclo: CicloRegistrado,
): Promise<{ cicloChave: string; status: StatusDoCiclo; motivo: string | null }> {
  const chave = ciclo.cicloChave;
  if (ciclo.status === "aplicado")
    return { cicloChave: chave, status: "nada_a_fazer", motivo: null };
  const totais: Totais = { ...ciclo.totais };
  const salvar = (extra: Parameters<RepositorioIngestao["mudarCiclo"]>[1] = {}) =>
    deps.executar((r) => r.mudarCiclo(chave, { totais, ...extra }));
  await deps.executar((r) =>
    r.mudarCiclo(chave, {
      status: "aplicando",
      motivo: null,
      ...(ciclo.status === "aplicando" ? {} : { fechadoEm: deps.agora() }),
    }),
  );
  try {
    if (!totais._fila_pronta) {
      totais._fila_iniciada_em = deps.agora().toISOString();
      await prepararFila(deps);
      totais._fila_pronta = true;
      totais._processados = 0;
      totais._blocos = 0;
      await salvar();
    }
    let pendentes = await deps.fila.contar(deps.empresaId);
    const t0 = deps.agora().getTime();
    while (pendentes > 0) {
      const r = await aplicarBloco(deps, {
        dryRun: false,
        limite: BLOCO,
        offset: 0,
        usuarioId: null,
      });
      for (const k of ["inserir", "atualizar", "ocorrencias", "ignorados"] as const) {
        totais[k] = num(totais[k]) + r.totais[k];
      }
      totais._processados = num(totais._processados) + r.processados;
      totais._blocos = num(totais._blocos) + 1;
      pendentes = r.pendentes;
      await salvar();
      if (r.processados === 0 || deps.agora().getTime() - t0 >= ORCAMENTO_CICLO_MS) break;
    }
    if (pendentes > 0) {
      const motivo = `aplicação em andamento: ${num(totais._processados)} documentos aplicados, ${pendentes} na fila`;
      await deps.executar((r) => r.mudarCiclo(chave, { motivo }));
      return { cicloChave: chave, status: "aguardando", motivo };
    }
    totais.romaneio_036 = (await aplicar036(deps, false)).alterados;
    try {
      totais.partes_455 = (await aplicarPartes455(deps)).alterados;
    } catch (e) {
      totais.partes_455_erro = e instanceof Error ? e.message : String(e);
    }
    const agora = deps.agora();
    const iniciada = totais._fila_iniciada_em ? new Date(totais._fila_iniciada_em) : agora;
    await deps.executar(async (r) => {
      await r.mudarCiclo(chave, { status: "aplicado", aplicadoEm: agora, totais });
      await r.fecharCiclosCobertos(iniciada, agora);
    });
    return { cicloChave: chave, status: "aplicado", motivo: null };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    // `_fila_pronta` só segue `true` se a preparação terminou (erro no 036 ou num bloco: a fila
    // já marcou o que foi). Erro na própria preparação deixa a fila vazia: marcá-la pronta faria a
    // retomada fechar o ciclo como aplicado sem aplicar nada.
    await deps.executar((r) => r.mudarCiclo(chave, { status: "erro", motivo, totais }));
    return { cicloChave: chave, status: "erro", motivo };
  }
}

/** Job `aplicar-ciclos`: aplica os ciclos abertos com arquivo importado, dentro do orçamento. */
export async function rodarCiclos(deps: DependenciasDoCiclo): Promise<{
  status: "ok" | "ja_rodando";
  resultados: Awaited<ReturnType<typeof aplicarCiclo>>[];
}> {
  const token = await deps.travas.adquirir(travaDoCiclo(deps.empresaId), LEASE_DO_CICLO_MS);
  if (token === null) return { status: "ja_rodando", resultados: [] };
  const resultados: Awaited<ReturnType<typeof aplicarCiclo>>[] = [];
  try {
    const inicio = deps.agora().getTime();
    const { ciclos, esperados } = await deps.executar(async (r) => ({
      ciclos: await r.ciclosAbertos(50),
      esperados: await r.relatoriosEsperados(),
    }));
    for (const ciclo of ciclos) {
      const arquivos = await deps.executar((r) => r.arquivosDoCiclo(ciclo.cicloChave));
      const av = avaliarCiclo(arquivos, esperados);
      if (!av.podeFechar) continue;
      await deps.executar((r) =>
        r.mudarCiclo(ciclo.cicloChave, { faltantes: av.faltantes, motivo: av.motivo }),
      );
      const r = await aplicarCiclo(deps, ciclo);
      resultados.push(r);
      if (r.status === "aguardando" || r.status === "erro") break;
      if (deps.agora().getTime() - inicio >= ORCAMENTO_RODADA_MS) break;
    }
  } finally {
    await deps.travas.liberar(travaDoCiclo(deps.empresaId), token);
  }
  return { status: "ok", resultados };
}

/** "Retomar ciclo" da tela: o mesmo `aplicarCiclo`, sob a mesma trava do automático. */
export async function retomarCiclo(deps: DependenciasDoCiclo, cicloChave: string) {
  const ciclo = await deps.executar((r) => r.ciclo(cicloChave));
  if (!ciclo) throw new ErroDeNegocio("NAO_ENCONTRADO", `Ciclo ${cicloChave} não encontrado.`);
  const token = await deps.travas.adquirir(travaDoCiclo(deps.empresaId), LEASE_DO_CICLO_MS);
  if (token === null) {
    throw new ErroDeNegocio(
      "CONFLITO",
      "A aplicação automática está rodando agora. Tente de novo em instantes.",
    );
  }
  try {
    return await aplicarCiclo(deps, ciclo);
  } finally {
    await deps.travas.liberar(travaDoCiclo(deps.empresaId), token);
  }
}

const formatarDataHora = (d: Date) =>
  d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

/** Relatórios que alimentam as projeções do Romaneio. */
const RELATORIOS_DAS_PROJECOES: ReadonlySet<string> = new Set(["036", "306", "038", "455csv"]);

/** Agrupa por CT-e o que as linhas apagadas trouxeram para as projeções do Romaneio. */
function descartadasPorCte(apagadas: readonly LinhaApagada[]): LinhasDescartadas[] {
  const porCte = new Map<
    string,
    { sigla: string; numero: string; r: Set<string>; rom: Set<string>; dias: Set<string> }
  >();
  for (const l of apagadas) {
    if (!RELATORIOS_DAS_PROJECOES.has(l.relatorio) || l.sigla === null || l.numero === null) {
      continue;
    }
    const k = chaveDoCte({ sigla: l.sigla, numero: l.numero });
    const d = porCte.get(k) ?? {
      sigla: l.sigla,
      numero: l.numero,
      r: new Set<string>(),
      rom: new Set<string>(),
      dias: new Set<string>(),
    };
    d.r.add(l.relatorio);
    if (l.relatorio === "036") {
      const { romaneio, data_emissao } = registro036.parse(l.dados);
      if (romaneio !== null) d.rom.add(romaneio);
      if (data_emissao !== null) d.dias.add(data_emissao);
    }
    porCte.set(k, d);
  }
  return [...porCte.values()].map((d) => ({
    sigla: d.sigla,
    numero: d.numero,
    relatorios: [...d.r],
    romaneios: [...d.rom],
    dias: [...d.dias],
  }));
}

/**
 * Descarta um ciclo não aplicado: apaga as linhas e os erros de todos os arquivos dele (Q51 b) e
 * pede às projeções do Romaneio que tirem o que essas linhas trouxeram.
 */
export async function descartarCiclo(
  deps: Pick<DependenciasDaAplicacao, "empresaId" | "executar" | "enfileirador">,
  cicloChave: string,
  motivo: string,
): Promise<{
  cicloChave: string;
  totalRemovido: number;
  porTabela: { linhas: number; erros: number };
}> {
  const { porTabela, apagadas } = await deps.executar(async (r) => {
    const ciclo = await r.ciclo(cicloChave);
    if (!ciclo) throw new ErroDeNegocio("NAO_ENCONTRADO", `Ciclo ${cicloChave} não encontrado.`);
    if (ciclo.status === "aplicado") {
      const quando = ciclo.aplicadoEm ? formatarDataHora(ciclo.aplicadoEm) : "?";
      throw new ErroDeNegocio(
        "CONFLITO",
        `Ciclo ${cicloChave} já foi aplicado à produção em ${quando} — descarte não permitido.`,
      );
    }
    const arquivos = await r.arquivosDoCiclo(cicloChave);
    const lotes = arquivos.flatMap((a) => (a.loteId ? [a.loteId] : []));
    const { apagadas, ...contagem } = await r.apagarLotes(lotes);
    await r.marcarArquivosDescartados(cicloChave);
    const total = contagem.linhas + contagem.erros;
    await r.mudarCiclo(cicloChave, {
      status: "descartado",
      motivo: `${motivo} — removidas ${total} linhas de staging: linhas ${contagem.linhas}, erros ${contagem.erros}`,
    });
    await r.auditar({
      acao: "descartar",
      entidade: "ingestao_ciclos",
      entidadeId: cicloChave,
      resumo: `Ciclo ${cicloChave} descartado (${total} linhas removidas)`,
      depois: { motivo, ...contagem },
    });
    return { porTabela: contagem, apagadas };
  });
  const descartadas = descartadasPorCte(apagadas);
  for (let i = 0; i < descartadas.length; i += JOB_PROJECOES_ROMANEIO.maxChaves) {
    const bloco = descartadas.slice(i, i + JOB_PROJECOES_ROMANEIO.maxChaves);
    await deps.enfileirador.enfileirar(JOB_PROJECOES_ROMANEIO.fila, JOB_PROJECOES_ROMANEIO.nome, {
      empresaId: deps.empresaId,
      chaves: bloco.map(({ sigla, numero }) => ({ sigla, numero })),
      descartadas: bloco,
    });
  }
  return { cicloChave, totalRemovido: porTabela.linhas + porTabela.erros, porTabela };
}

/**
 * Job `repassar-fila`: um bloco da passada completa em segundo plano, só sem ciclo aberto e com a
 * fila principal vazia, e sob a mesma trava do ciclo (nunca junto com a aplicação dos dados
 * novos). O ciclo aberto conta à parte da trava: num banco longe, o bloco de 4000 do ciclo passa
 * da validade dela.
 */
export async function repassarFila(
  deps: DependenciasDoCiclo & { repasse: FilaDeAplicacao },
): Promise<{
  status: "vazio" | "aguardando_ciclo" | "ja_rodando" | "ok";
  processados: number;
  pendentes: number;
}> {
  const pendentes = await deps.repasse.contar(deps.empresaId);
  if (pendentes === 0) return { status: "vazio", processados: 0, pendentes };
  const cicloAberto = (await deps.executar((r) => r.ciclosAbertos(1))).length > 0;
  if (cicloAberto || (await deps.fila.contar(deps.empresaId)) > 0) {
    return { status: "aguardando_ciclo", processados: 0, pendentes };
  }
  const token = await deps.travas.adquirir(travaDoCiclo(deps.empresaId), LEASE_DO_CICLO_MS);
  if (token === null) return { status: "ja_rodando", processados: 0, pendentes };
  try {
    // Repasse com chave (checado acima): o aplicarBloco não refaz a fila.
    const r = await aplicarBloco(
      { ...deps, fila: deps.repasse },
      { dryRun: false, limite: BLOCO_DO_REPASSE, offset: 0, usuarioId: null },
    );
    return { status: "ok", processados: r.processados, pendentes: r.pendentes };
  } finally {
    await deps.travas.liberar(travaDoCiclo(deps.empresaId), token);
  }
}
