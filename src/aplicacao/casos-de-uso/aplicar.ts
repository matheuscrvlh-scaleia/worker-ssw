/**
 * Aplicação da staging no CT-e e nas ocorrências, em blocos de chaves (sigla + número) tirados da
 * fila da empresa. Spec 06 §3.11 e §3.12; Q02 (sigla + número: sem série vigente nem CT-e
 * "estacionado"), Q19 (`previsao_ssw_*`), Q20 (recalcula tudo), Q22 (finalizadores do cadastro).
 * origem: aplicar_staging_ssw / ssw_fila_preparar* / ssw_aplicar_estornos (sistema atual)
 */
import { randomUUID } from "node:crypto";

import {
  type CodigoNovo,
  codigoRecebidoSemCadastro,
  CODIGOS_ENTREGA,
  codigosDeBaixa,
  filiaisProprias,
  montarCatalogo,
  type OcorrenciaDoCte,
  prepararGravacaoDoCte,
  prepararOcorrencia,
} from "@erp/dominio/nucleo";
import { JOB_PROJECOES_ROMANEIO } from "@erp/shared/ingestao";

import { type Registro038, type Registro455Csv, type Registro930 } from "../../fontes/relatorios";
import {
  agregar455,
  agregar930,
  anuladas930,
  type CamposDoCte,
  camposDoCteNovo,
  camposSswDoCte,
  type Candidato,
  type ChaveCte,
  chaveDeTexto,
  chaveDoCte,
  type CteDaIngestao,
  diferencasDoCte,
  efeitoDoEstorno,
  type LinhaGuardada,
  montarCandidato,
  ocorrenciasDo930,
  precisaPreparacaoCompleta,
  ultimo038,
} from "../regras";
import { cteEmBranco, regravarCte } from "./gravar-cte";
import {
  type CadastrosDoNucleo,
  type Enfileirador,
  type FilaDeAplicacao,
  type LinhaDaChave,
  type OcorrenciaNova,
  RELATORIOS_DA_FILA,
  type RepositorioIngestao,
  type Transacional,
} from "./portas";

/** Itens de cada lista guardados no resultado (a tela mostra até 500). */
const AMOSTRA = 500;

export interface DependenciasDaAplicacao {
  empresaId: string;
  executar: Transacional;
  fila: FilaDeAplicacao;
  enfileirador: Enfileirador;
  agora: () => Date;
}

export interface TotaisDoBloco {
  inserir: number;
  atualizar: number;
  ocorrencias: number;
  ignorados: number;
}

export interface ResultadoDoBloco {
  dryRun: boolean;
  offset: number;
  processados: number;
  candidatos: number;
  pendentes: number;
  totais: TotaisDoBloco;
  inserir: { chave: string; dataEmissao: string | null; previsao: string | null }[];
  atualizar: { chave: string; campos: string[] }[];
  ocorrencias: { chave: string; codigo: number; dataHora: string }[];
  ignorados: { chave: string; motivo: string }[];
}

// --- Fila --------------------------------------------------------------------------------------

/**
 * Prepara a fila: completa uma vez por dia depois das 03:00 de São Paulo (ou quando pedido), senão
 * só acrescenta as chaves com linha pendente (`aplicado_em` nulo) — linha regravada por um
 * arquivo novo volta a ficar pendente, e a chave já aplicada volta para o fim da fila.
 */
export async function prepararFila(
  deps: DependenciasDaAplicacao,
  forcarCompleta = false,
): Promise<{ modo: "completa" | "incremental"; enfileirados: number }> {
  const agora = deps.agora();
  const controle = await deps.fila.controle(deps.empresaId);
  const completa = forcarCompleta || precisaPreparacaoCompleta(agora, controle);
  if (completa) {
    const chaves = await deps.executar((r) => r.todasAsChaves(RELATORIOS_DA_FILA));
    await deps.fila.substituir(deps.empresaId, chaves.map(chaveDoCte));
    await deps.fila.registrarPreparacao(deps.empresaId, true, agora);
    return { modo: "completa", enfileirados: chaves.length };
  }
  const chaves = await deps.executar((r) =>
    r.chavesPendentes(RELATORIOS_DA_FILA, Number.MAX_SAFE_INTEGER),
  );
  const enfileirados = await deps.fila.acrescentar(deps.empresaId, chaves.map(chaveDoCte));
  await deps.fila.registrarPreparacao(deps.empresaId, false, agora);
  return { modo: "incremental", enfileirados };
}

// --- Bloco -------------------------------------------------------------------------------------

function agrupar(linhas: readonly LinhaDaChave[]): Map<string, LinhaDaChave[]> {
  const grupos = new Map<string, LinhaDaChave[]>();
  for (const l of linhas) {
    const k = chaveDoCte(l);
    const g = grupos.get(k);
    if (g) g.push(l);
    else grupos.set(k, [l]);
  }
  return grupos;
}

function guardadas<R>(linhas: readonly LinhaDaChave[] | undefined): LinhaGuardada<R>[] {
  return (linhas ?? []).map((l) => ({
    id: l.id,
    loteId: l.loteId,
    importadoEm: l.importadoEm,
    dados: l.dados as R,
  }));
}

interface Plano {
  chave: string;
  cand: Candidato;
  prod: CteDaIngestao | null;
  campos: CamposDoCte;
  lin930: LinhaGuardada<Registro930>[];
  anuladas: Set<number>;
  temAnulada: boolean;
}

const chaveDaOcorrencia = (codigo: number, dataHora: Date) => `${codigo}|${dataHora.getTime()}`;

/**
 * Aplica as chaves numa transação. Simulação (`dryRun`) não grava nada e devolve o mesmo resumo.
 * Devolve também as chaves cujo CT-e mudou (para as projeções do romaneio).
 */
export async function aplicarChaves(
  r: RepositorioIngestao,
  chaves: readonly ChaveCte[],
  opcoes: { dryRun: boolean; agora: Date; contarSemChave: boolean },
): Promise<{
  totais: TotaisDoBloco;
  amostras: Omit<
    ResultadoDoBloco,
    "dryRun" | "offset" | "processados" | "pendentes" | "totais" | "candidatos"
  >;
  candidatos: number;
  mudaram: string[];
}> {
  const { dryRun, agora } = opcoes;
  const empresa = await r.empresa();
  let cad: CadastrosDoNucleo = await r.cadastrosDoNucleo();
  const finalizadores = new Set([...CODIGOS_ENTREGA, ...codigosDeBaixa(cad.catalogo)]);
  const g930 = agrupar(await r.linhasDasChaves("930", chaves));
  const g038 = agrupar(await r.linhasDasChaves("038", chaves));
  const g455 = agrupar(await r.linhasDasChaves("455csv", chaves));
  const prods = new Map((await r.ctesDasChaves(chaves)).map((c) => [chaveDoCte(c), c]));

  const ignorados: { chave: string; motivo: string }[] = [];
  const planos: Plano[] = [];
  for (const ch of chaves) {
    const k = chaveDoCte(ch);
    const lin930 = guardadas<Registro930>(g930.get(k));
    const lin038 = guardadas<Registro038>(g038.get(k));
    const lin455 = guardadas<Registro455Csv>(g455.get(k));
    const anuladas = anuladas930(lin930, finalizadores);
    const c = agregar930(lin930, anuladas);
    const b = agregar455(lin455);
    const a = ultimo038(lin038);
    if (!c && !b && !a) continue;
    const prod = prods.get(k) ?? null;
    const cand = montarCandidato({ chave: ch, c, b, a, prod, dominioSsw: empresa.dominioSsw });
    const campos = prod ? diferencasDoCte(prod, cand) : camposDoCteNovo(cand);
    if (campos === null) {
      ignorados.push({ chave: k, motivo: "sem_data_emissao" });
      continue;
    }
    planos.push({
      chave: k,
      cand,
      prod,
      campos,
      lin930,
      anuladas,
      temAnulada: c?.temAnulada ?? false,
    });
  }
  if (opcoes.contarSemChave) {
    const semChave = await r.linhasSemChave(RELATORIOS_DA_FILA);
    if (semChave > 0)
      ignorados.push({ chave: `${semChave} linha(s)`, motivo: "chave_irrecuperavel" });
  }

  const emissaoDoPlano = (p: Plano, cte: CteDaIngestao | null) =>
    p.campos.dataEmissao ?? cte?.dataEmissao ?? null;
  const ocorrenciasNovasDoPlano = (
    p: Plano,
    cte: CteDaIngestao | null,
    existentes: readonly OcorrenciaDoCte[],
  ) => {
    const emissao = emissaoDoPlano(p, cte);
    if (emissao === null) return [];
    const ja = new Set(existentes.map((o) => chaveDaOcorrencia(o.codigo, o.dataHora)));
    return ocorrenciasDo930(p.lin930, p.anuladas, emissao).filter(
      (o) => !ja.has(chaveDaOcorrencia(o.codigo, o.dataHora)),
    );
  };

  if (dryRun) {
    const ids = planos.flatMap((p) => (p.prod ? [p.prod.id] : []));
    const existentes = await r.ocorrenciasDosCtes(ids);
    const ocorrencias = planos.flatMap((p) =>
      ocorrenciasNovasDoPlano(p, p.prod, p.prod ? (existentes.get(p.prod.id) ?? []) : []).map(
        (o) => ({ chave: p.chave, codigo: o.codigo, dataHora: o.dataHora.toISOString() }),
      ),
    );
    const inserir = planos.filter((p) => !p.prod);
    const atualizar = planos.filter((p) => p.prod && Object.keys(p.campos).length > 0);
    return {
      candidatos: planos.length,
      mudaram: [],
      totais: {
        inserir: inserir.length,
        atualizar: atualizar.length,
        ocorrencias: ocorrencias.length,
        ignorados: ignorados.length,
      },
      amostras: {
        inserir: inserir.slice(0, AMOSTRA).map((p) => ({
          chave: p.chave,
          dataEmissao: p.cand.dataEmissao,
          previsao: p.cand.previsao,
        })),
        atualizar: atualizar
          .slice(0, AMOSTRA)
          .map((p) => ({ chave: p.chave, campos: Object.keys(p.campos) })),
        ocorrencias: ocorrencias.slice(0, AMOSTRA),
        ignorados: ignorados.slice(0, AMOSTRA),
      },
    };
  }

  // (6a) CT-e novos: o núcleo decide (data mínima de emissão) e deriva antes do INSERT.
  const novos: CteDaIngestao[] = [];
  for (const p of planos) {
    if (p.prod) continue;
    const linha = { ...cteEmBranco(empresa.id, randomUUID(), agora), ...p.campos };
    const g = prepararGravacaoDoCte({
      antigo: null,
      novo: linha,
      fonte: "outra",
      contexto: { ...cad, ocorrencias: [], ocorrenciasMudaram: false },
    });
    if (g.tipo === "descartar") ignorados.push({ chave: p.chave, motivo: g.motivo });
    else novos.push(g.cte);
  }
  const inseridos = new Map((await r.inserirCtes(novos)).map((c) => [chaveDoCte(c), c]));
  const cteDoPlano = (p: Plano) => p.prod ?? inseridos.get(p.chave) ?? null;
  const ativos = planos.filter((p) => cteDoPlano(p) !== null);
  const ids = ativos.flatMap((p) => cteDoPlano(p)?.id ?? []);

  // (7) Ocorrências do 930: código sem cadastro entra pendente de classificação.
  const existentes = await r.ocorrenciasDosCtes(ids);
  const porPlano = ativos.map((p) => {
    const cte = cteDoPlano(p);
    return {
      p,
      cte,
      oc: ocorrenciasNovasDoPlano(p, cte, cte ? (existentes.get(cte.id) ?? []) : []),
    };
  });
  const semCadastro = new Map<number, CodigoNovo>();
  for (const { oc } of porPlano) {
    for (const o of oc) {
      if (cad.catalogo.has(o.codigo) || semCadastro.has(o.codigo)) continue;
      const novo = codigoRecebidoSemCadastro(o.codigo, o.descricao);
      if (novo) semCadastro.set(o.codigo, novo);
    }
  }
  if (semCadastro.size > 0) {
    await r.inserirCodigos([...semCadastro.values()]);
    cad = { ...cad, catalogo: montarCatalogo([...cad.catalogo.values(), ...semCadastro.values()]) };
  }
  const empresaDaOcorrencia = {
    dominioSsw: empresa.dominioSsw,
    filiaisProprias: new Set(filiaisProprias(cad.filiais)),
  };
  const ocorrenciasNovas: OcorrenciaNova[] = [];
  for (const { p, cte, oc } of porPlano) {
    const emissao = emissaoDoPlano(p, cte);
    if (!cte || emissao === null) continue;
    for (const o of oc) {
      const prep = prepararOcorrencia({
        ocorrencia: {
          codigo: o.codigo,
          dataHora: o.dataHora,
          origem: "ssw_930",
          responsavel: null,
          quarentena: false,
        },
        cte: { dataEmissao: emissao, criadoEm: cte.criadoEm },
        catalogo: cad.catalogo,
        empresa: empresaDaOcorrencia,
        trackingdanfe: null,
      });
      if (prep.tipo === "descartar") continue;
      ocorrenciasNovas.push({
        cteId: cte.id,
        ...o,
        origem: "ssw_930",
        responsavel: prep.responsavel,
        penaliza: prep.penaliza,
        quarentena: prep.quarentena,
      });
    }
  }
  const inseridas = await r.inserirOcorrencias(ocorrenciasNovas);
  const totalOcorrencias = inseridas.length;
  // CT-e com ocorrência inserida ou apagada: só neles o status atual é refeito (gatilho de hoje).
  const comOcorrenciaGravada = new Set(inseridas);

  // §3.12 Estorno (86): apaga as ocorrências anuladas e refaz a entrega.
  const entregaDoEstorno = new Map<string, Date | null>();
  for (const { p, cte } of porPlano) {
    const emissao = emissaoDoPlano(p, cte);
    if (!cte || !p.temAnulada || emissao === null) continue;
    const ligadas = p.lin930.filter((l) => l.dados.emissao_ctrc === emissao);
    const efeito = efeitoDoEstorno(ligadas, p.anuladas, finalizadores, cte.dataEntregaRealizada);
    for (const o of efeito.apagar) {
      if ((await r.apagarOcorrencia(cte.id, o.codigo, o.dataHora)) > 0) {
        comOcorrenciaGravada.add(cte.id);
      }
    }
    if (efeito.entrega !== undefined) entregaDoEstorno.set(cte.id, efeito.entrega);
  }

  // (6b/6c) Atualização + derivados do núcleo + campos_ssw, numa gravação por CT-e.
  const ocorrencias = await r.ocorrenciasDosCtes(ids);
  let atualizados = 0;
  const mudaram: string[] = [];
  for (const { p, cte } of porPlano) {
    if (!cte) continue;
    const campos: CamposDoCte = p.prod ? { ...p.campos } : {};
    const entrega = entregaDoEstorno.get(cte.id);
    if (entrega !== undefined) campos.dataEntregaRealizada = entrega;
    const res = await regravarCte(r, cad, cte, campos, ocorrencias.get(cte.id) ?? [], agora, {
      ajustar: (final) => ({ camposSsw: camposSswDoCte(final, p.cand) }),
      ocorrenciasMudaram: comOcorrenciaGravada.has(cte.id),
    });
    if (res.tipo === "descartado") ignorados.push({ chave: p.chave, motivo: res.motivo });
    if (res.tipo === "gravado" && p.prod) atualizados++;
    if (res.tipo === "gravado" || !p.prod) mudaram.push(p.chave);
  }
  await r.marcarAplicadas(RELATORIOS_DA_FILA, chaves, agora);

  const totais = {
    inserir: inseridos.size,
    atualizar: atualizados,
    ocorrencias: totalOcorrencias,
    ignorados: ignorados.length,
  };
  await r.auditar({
    acao: "aplicar",
    entidade: "ctes",
    entidadeId: null,
    resumo: `Aplicação SSW: ${totais.inserir} CT-e novos, ${totais.atualizar} atualizados, ${totais.ocorrencias} ocorrências`,
    depois: { ...totais, chaves: chaves.length },
  });
  return {
    candidatos: planos.length,
    mudaram,
    totais,
    amostras: {
      inserir: [...inseridos.values()].slice(0, AMOSTRA).map((c) => ({
        chave: chaveDoCte(c),
        dataEmissao: c.dataEmissao,
        previsao: c.dataPrevistaEntrega,
      })),
      atualizar: porPlano
        .filter(({ p }) => p.prod && Object.keys(p.campos).length > 0)
        .slice(0, AMOSTRA)
        .map(({ p }) => ({ chave: p.chave, campos: Object.keys(p.campos) })),
      ocorrencias: ocorrenciasNovas.slice(0, AMOSTRA).map((o) => ({
        chave: porPlano.find((x) => x.cte?.id === o.cteId)?.p.chave ?? "",
        codigo: o.codigo,
        dataHora: o.dataHora.toISOString(),
      })),
      ignorados: ignorados.slice(0, AMOSTRA),
    },
  };
}

/** Avisa o romaneio das chaves que mudaram. */
export async function avisarProjecoes(
  enfileirador: Enfileirador,
  empresaId: string,
  chaves: readonly string[],
): Promise<void> {
  for (let i = 0; i < chaves.length; i += JOB_PROJECOES_ROMANEIO.maxChaves) {
    await enfileirador.enfileirar(JOB_PROJECOES_ROMANEIO.fila, JOB_PROJECOES_ROMANEIO.nome, {
      empresaId,
      chaves: chaves.slice(i, i + JOB_PROJECOES_ROMANEIO.maxChaves).map(chaveDeTexto),
    });
  }
}

/**
 * Um bloco da fila: simulação (paginada por `offset`) ou aplicação de verdade. Com a fila vazia
 * refaz a fila inteira (botão manual). Registra a tentativa em `ingestao_aplicacoes`.
 */
export async function aplicarBloco(
  deps: DependenciasDaAplicacao,
  opcoes: { dryRun: boolean; limite: number; offset: number; usuarioId: string | null },
): Promise<ResultadoDoBloco> {
  const { dryRun, limite } = opcoes;
  const offset = dryRun ? opcoes.offset : 0;
  if ((await deps.fila.contar(deps.empresaId)) === 0) await prepararFila(deps, true);
  const textos = await deps.fila.pendentes(deps.empresaId, offset, limite);
  const logId = await deps.executar((r) => r.iniciarAplicacao(dryRun, opcoes.usuarioId));
  try {
    const res = await deps.executar((r) =>
      aplicarChaves(r, textos.map(chaveDeTexto), {
        dryRun,
        agora: deps.agora(),
        contarSemChave: offset === 0,
      }),
    );
    if (!dryRun) {
      await deps.fila.remover(deps.empresaId, textos);
      await avisarProjecoes(deps.enfileirador, deps.empresaId, res.mudaram);
    }
    const resultado: ResultadoDoBloco = {
      dryRun,
      offset,
      processados: textos.length,
      candidatos: res.candidatos,
      pendentes: await deps.fila.contar(deps.empresaId),
      totais: res.totais,
      ...res.amostras,
    };
    await deps.executar((r) =>
      r.finalizarAplicacao(logId, "concluido", res.totais, { ...resultado }, null),
    );
    return resultado;
  } catch (e) {
    const erro = (e instanceof Error ? e.message : String(e)).slice(0, 4000);
    await deps.executar((r) =>
      r.finalizarAplicacao(
        logId,
        "erro",
        { inserir: 0, atualizar: 0, ocorrencias: 0, ignorados: 0 },
        null,
        erro,
      ),
    );
    throw e;
  }
}
