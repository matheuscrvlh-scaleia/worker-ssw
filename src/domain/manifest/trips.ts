/**
 * Telas "por viagem" do Romaneio: Por romaneio, Performance Motorista/Ajudante/Carro, CTRC por
 * carro e a aba Prejuízo. O CT-e conta em cada viagem; entregue só na última; prejuízo e retorno
 * na viagem do dia da ocorrência. Spec: docs/regras/03-romaneio-prazo-parceiro.md §0.3, §3.4–§3.8.
 *
 * Decisões do dono: Q14 (prejuízo na janela do período em todas as abas, inclusive Prejuízo) e
 * Q15 (prejuízo só de CT-e que saiu para entrega, inclusive na Performance Motorista/Ajudante).
 */
import { diaSp, horaSp, normalizarNome } from "../core";
import { arredondar, centavos, reais } from "../performance/numbers";
import { chaveAjudante, CODIGO_RETORNO, COLLATOR, maxTexto, normNome } from "./normalization";
import {
  type Cadastro,
  type CteAnalisado,
  ehPenalizanteFR,
  type FatoCte,
  ocorrenciasPenalizantes,
  type Periodo,
  teveRetorno,
} from "./status";

/** Uma viagem do CT-e (projeção `romaneio_viagens_cte`). */
export interface Viagem {
  romaneio: string;
  situacao: string | null;
  dataSaida: string;
  placa: string | null;
  motorista: string | null;
  motoristaNormalizado: string | null;
  ajudante: string | null;
  ajudante2: string | null;
  ajudante3: string | null;
  primeira: boolean;
  ultima: boolean;
  proximaSaida: string | null;
}

export interface CteComViagens extends CteAnalisado {
  viagens: readonly Viagem[];
}

/**
 * A ocorrência cai na viagem cujo intervalo contém o dia dela: [saída, próxima saída), e a 1ª
 * viagem vale desde sempre. Duas viagens no mesmo dia: a primeira fica com intervalo vazio.
 * origem: _romaneio_ocorrencia_na_viagem
 */
export function ocorrenciaNaViagem(
  c: FatoCte,
  v: Viagem,
  codigos: readonly number[],
  janela: Periodo | null,
  regra: "prejuizo" | "retorno",
  cadastro: Cadastro,
): boolean {
  return c.ocorrencias.some((o) => {
    if (!codigos.includes(o.codigo)) return false;
    const dia = diaSp(o.dataHora);
    if (janela && (dia < janela.inicio || dia > janela.fim)) return false;
    if (!v.primeira && dia < v.dataSaida) return false;
    if (v.proximaSaida !== null && dia >= v.proximaSaida) return false;
    return regra === "prejuizo" ? ehPenalizanteFR(cadastro, o.codigo) : !o.quarentena;
  });
}

/** Regras comuns às telas por viagem. */
export interface ContextoPorViagem {
  cadastro: Cadastro;
  codigosPrejuizo: readonly number[];
  periodo: Periodo;
}

/** Prejuízo na viagem: CT-e prejudicado e a ocorrência dentro do intervalo da viagem. */
function prejudicadoNaViagem(item: CteComViagens, v: Viagem | null, ctx: ContextoPorViagem) {
  if (!item.analise.prejudicado) return false;
  if (v === null || (v.primeira && v.ultima)) return true;
  return ocorrenciaNaViagem(
    item.fato,
    v,
    ctx.codigosPrejuizo,
    ctx.periodo,
    "prejuizo",
    ctx.cadastro,
  );
}

/** Prejuízo pelo 13 no período (cadastro do 13 penaliza e é da FR). */
function prejudicado13(c: FatoCte, ctx: ContextoPorViagem): boolean {
  return ocorrenciasPenalizantes(c, { ...ctx, codigosPrejuizo: [CODIGO_RETORNO] }).length > 0;
}

function prejudicado13NaViagem(item: CteComViagens, v: Viagem | null, ctx: ContextoPorViagem) {
  if (!prejudicado13(item.fato, ctx)) return false;
  if (v === null || (v.primeira && v.ultima)) return true;
  return ocorrenciaNaViagem(item.fato, v, [CODIGO_RETORNO], ctx.periodo, "prejuizo", ctx.cadastro);
}

function retornoNaViagem(item: CteComViagens, v: Viagem | null, cadastro: Cadastro): boolean {
  if (!teveRetorno(item.fato)) return false;
  if (v === null || (v.primeira && v.ultima)) return true;
  return ocorrenciaNaViagem(item.fato, v, [CODIGO_RETORNO], null, "retorno", cadastro);
}

const saiu = (item: CteAnalisado) => item.analise.saiuEntrega === "sim";

function juntarOrdenado(valores: Iterable<string | null>): string | null {
  const unicos = [...new Set([...valores].filter((v): v is string => v !== null))];
  return unicos.length === 0 ? null : unicos.sort(COLLATOR.compare).join(", ");
}

// ---------------------------------------------------------------------------------------------
// Por romaneio (viagem real)

export interface LinhaPorViagem {
  romaneio: string;
  dataRomaneio: string;
  situacao: string | null;
  placa: string | null;
  motorista: string | null;
  ajudante: string | null;
  ajudante2: string | null;
  ajudante3: string | null;
  ctes: number;
  frete: number;
  entregues: number;
  naoEntregues: number;
  performance: number | null;
  fretePerdido: number;
  transferidas: number;
}

/** Busca do romaneio: contém o texto, ou os dígitos contêm os dígitos digitados. */
export function casaBuscaRomaneio(romaneio: string, busca: string | null): boolean {
  const q = (busca ?? "").trim();
  if (q === "") return true;
  if (romaneio.toLowerCase().includes(q.toLowerCase())) return true;
  const digitos = q.replace(/\D/g, "");
  return digitos !== "" && romaneio.replace(/\D/g, "").includes(digitos);
}

/**
 * Uma linha por romaneio. As viagens já vêm filtradas (período por saída, placa, motorista).
 * origem: romaneio_por_viagem
 */
export function porViagem(
  itens: readonly CteComViagens[],
  ctx: ContextoPorViagem,
  busca: string | null,
): LinhaPorViagem[] {
  const grupos = new Map<string, { v: Viagem; item: CteComViagens }[]>();
  for (const item of itens) {
    for (const v of item.viagens) {
      if (!casaBuscaRomaneio(v.romaneio, busca)) continue;
      const lista = grupos.get(v.romaneio) ?? [];
      lista.push({ v, item });
      grupos.set(v.romaneio, lista);
    }
  }
  const linhas = [...grupos].map(([romaneio, viagens]): LinhaPorViagem => {
    // Dinheiro em centavos inteiros, como o `sum(numeric)` do banco.
    let frete = 0;
    let entregues = 0;
    let fretePerdido = 0;
    let transferidas = 0;
    for (const { v, item } of viagens) {
      frete += centavos(item.fato.valorFrete);
      if (item.analise.entregue && v.ultima) entregues += 1;
      if (!v.ultima) transferidas += 1;
      if (prejudicadoNaViagem(item, v, ctx)) fretePerdido += centavos(item.fato.valorFrete);
    }
    const vs = viagens.map((x) => x.v);
    return {
      romaneio,
      dataRomaneio: vs.map((v) => v.dataSaida).reduce((a, b) => (b > a ? b : a)),
      situacao: maxTexto(vs.map((v) => v.situacao)),
      placa: maxTexto(vs.map((v) => v.placa)),
      motorista: maxTexto(vs.map((v) => v.motorista)),
      ajudante: maxTexto(vs.map((v) => v.ajudante)),
      ajudante2: maxTexto(vs.map((v) => v.ajudante2)),
      ajudante3: maxTexto(vs.map((v) => v.ajudante3)),
      ctes: viagens.length,
      frete: reais(frete),
      entregues,
      naoEntregues: viagens.length - entregues,
      performance: arredondar((100 * entregues) / viagens.length, 1),
      fretePerdido: reais(fretePerdido),
      transferidas,
    };
  });
  return linhas
    .sort((a, b) => b.ctes - a.ctes || COLLATOR.compare(a.romaneio, b.romaneio))
    .slice(0, busca?.trim() ? 1000 : 300);
}

// ---------------------------------------------------------------------------------------------
// Performance Motorista / Ajudante / Carro

export interface LinhaPerformancePessoa {
  nome: string;
  /** Placas usadas (nulo sem a permissão `romaneio_placa`). */
  placas: string | null;
  equipe: string | null;
  viagens: number;
  romaneados: number;
  entregues: number;
  retornos: number;
  prejudicadas: number;
  prejudicadas13: number;
  performance: number;
}

interface Acumulador {
  placas: Set<string>;
  romaneados: number;
  entregues: number;
  retornos: number;
  prejudicadas: number;
  prejudicadas13: number;
}

const novoAcumulador = (): Acumulador => ({
  placas: new Set(),
  romaneados: 0,
  entregues: 0,
  retornos: 0,
  prejudicadas: 0,
  prejudicadas13: 0,
});

function acumular(acc: Acumulador, item: CteComViagens, v: Viagem | null, ctx: ContextoPorViagem) {
  const prej = prejudicadoNaViagem(item, v, ctx);
  if (prej) acc.prejudicadas += 1;
  if (!saiu(item)) return;
  acc.romaneados += 1;
  if (v?.placa) acc.placas.add(v.placa);
  if (item.analise.entregue && (v?.ultima ?? true)) acc.entregues += 1;
  if (retornoNaViagem(item, v, ctx.cadastro) && !item.analise.entregue && !item.analise.finalizado)
    acc.retornos += 1;
  if (prejudicado13NaViagem(item, v, ctx)) acc.prejudicadas13 += 1;
}

const performanceDe = (romaneados: number, prejudicadas13: number) =>
  romaneados > 0 ? arredondar((100 * Math.max(romaneados - prejudicadas13, 0)) / romaneados, 2) : 0;

function linhaDaPessoa(
  nome: string,
  acc: Acumulador,
  viagens: number,
  equipe: string | null,
  verPlaca: boolean,
): LinhaPerformancePessoa {
  return {
    nome,
    placas: verPlaca ? juntarOrdenado(acc.placas) : null,
    equipe,
    viagens,
    romaneados: acc.romaneados,
    entregues: acc.entregues,
    retornos: acc.retornos,
    prejudicadas: acc.prejudicadas,
    prejudicadas13: acc.prejudicadas13,
    performance: performanceDe(acc.romaneados, acc.prejudicadas13),
  };
}

const porRomaneados = (a: LinhaPerformancePessoa, b: LinhaPerformancePessoa) =>
  b.romaneados - a.romaneados || COLLATOR.compare(a.nome, b.nome);

/** Membro motorista ativo de equipe (para a coluna Equipe). */
export interface MotoristaDeEquipe {
  nome: string;
  equipe: string;
}

/**
 * Por motorista (texto do 036). CT-e sem viagem conta para "—" (só sem filtro de placa/motorista,
 * que o repositório já aplicou nas viagens).
 * origem: romaneio_performance_motorista
 */
export function performanceMotorista(
  itens: readonly CteComViagens[],
  ctx: ContextoPorViagem,
  equipes: readonly MotoristaDeEquipe[],
  opcoes: { verPlaca: boolean; exigeViagem: boolean },
): LinhaPerformancePessoa[] {
  const acc = new Map<string, Acumulador>();
  const viagensPorNome = new Map<string, Set<string>>();
  for (const item of itens) {
    const viagens: (Viagem | null)[] =
      item.viagens.length > 0 ? [...item.viagens] : opcoes.exigeViagem ? [] : [null];
    for (const v of viagens) {
      const nome = v?.motorista ?? "—";
      const a = acc.get(nome) ?? novoAcumulador();
      acc.set(nome, a);
      acumular(a, item, v, ctx);
      if (v && saiu(item)) {
        const chave = normNome(v.motorista) ?? "";
        const set = viagensPorNome.get(chave) ?? new Set();
        set.add(v.romaneio);
        viagensPorNome.set(chave, set);
      }
    }
  }
  const equipePorNome = new Map<string, string>();
  for (const m of equipes) {
    const chave = normalizarNome(m.nome);
    const atual = equipePorNome.get(chave);
    if (atual === undefined || COLLATOR.compare(m.equipe, atual) > 0)
      equipePorNome.set(chave, m.equipe);
  }
  return [...acc]
    .filter(([, a]) => a.romaneados > 0 || a.prejudicadas > 0)
    .map(([nome, a]) =>
      linhaDaPessoa(
        nome,
        a,
        viagensPorNome.get(normNome(nome) ?? "")?.size ?? 0,
        equipePorNome.get(normalizarNome(nome)) ?? null,
        opcoes.verPlaca,
      ),
    )
    .sort(porRomaneados);
}

/**
 * Por ajudante: só CT-e com viagem; uma linha por ajudante não vazio da viagem (o mesmo nome em
 * duas posições conta duas vezes). `ajudantes` filtra por `trim(upper(nome))`.
 * origem: romaneio_performance_ajudante
 */
export function performanceAjudante(
  itens: readonly CteComViagens[],
  ctx: ContextoPorViagem,
  ajudantes: readonly string[] | null,
  verPlaca: boolean,
): LinhaPerformancePessoa[] {
  const acc = new Map<string, Acumulador>();
  const viagensPorNome = new Map<string, Set<string>>();
  for (const item of itens) {
    for (const v of item.viagens) {
      for (const bruto of [v.ajudante, v.ajudante2, v.ajudante3]) {
        const nome = chaveAjudante(bruto);
        if (nome === null || (ajudantes && !ajudantes.includes(nome))) continue;
        const a = acc.get(nome) ?? novoAcumulador();
        acc.set(nome, a);
        acumular(a, item, v, ctx);
        if (saiu(item)) {
          const set = viagensPorNome.get(nome) ?? new Set();
          set.add(v.romaneio);
          viagensPorNome.set(nome, set);
        }
      }
    }
  }
  return [...acc]
    .filter(([, a]) => a.romaneados > 0 || a.prejudicadas > 0)
    .map(([nome, a]) => linhaDaPessoa(nome, a, viagensPorNome.get(nome)?.size ?? 0, null, verPlaca))
    .sort(porRomaneados);
}

export interface LinhaPerformanceCarro {
  motorista: string;
  placa: string | null;
  romaneados: number;
  entregues: number;
  prejudicadas: number;
}

/**
 * Por (motorista, placa). Aqui o prejuízo também exige ter saído.
 * origem: romaneio_performance_carro
 */
export function performanceCarro(
  itens: readonly CteComViagens[],
  ctx: ContextoPorViagem,
  exigeViagem: boolean,
): LinhaPerformanceCarro[] {
  const grupos = new Map<string, LinhaPerformanceCarro>();
  for (const item of itens) {
    if (!saiu(item)) continue;
    const viagens: (Viagem | null)[] =
      item.viagens.length > 0 ? [...item.viagens] : exigeViagem ? [] : [null];
    for (const v of viagens) {
      const motorista = v?.motorista ?? "—";
      const placa = v?.placa ?? null;
      const chave = JSON.stringify([motorista, placa]);
      const g = grupos.get(chave) ?? {
        motorista,
        placa,
        romaneados: 0,
        entregues: 0,
        prejudicadas: 0,
      };
      grupos.set(chave, g);
      g.romaneados += 1;
      if (item.analise.entregue && (v?.ultima ?? true)) g.entregues += 1;
      if (prejudicadoNaViagem(item, v, ctx)) g.prejudicadas += 1;
    }
  }
  return [...grupos.values()].sort(
    (a, b) =>
      b.prejudicadas - a.prejudicadas ||
      b.romaneados - a.romaneados ||
      COLLATOR.compare(a.motorista, b.motorista),
  );
}

// ---------------------------------------------------------------------------------------------
// CTRC por carro

export interface LinhaCtesPorCarro {
  placa: string | null;
  motorista: string | null;
  ctes: number;
  peso: number;
  volumes: number;
  frete: number;
}

/**
 * CT-e que saíram, uma linha por viagem, agrupadas por placa; sem viagem = placa nula.
 * origem: romaneio_notas_por_carro
 */
export function ctesPorCarro(itens: readonly CteComViagens[]): LinhaCtesPorCarro[] {
  const grupos = new Map<
    string | null,
    { linha: LinhaCtesPorCarro; motoristas: (string | null)[] }
  >();
  for (const item of itens) {
    if (!saiu(item)) continue;
    const viagens: (Viagem | null)[] = item.viagens.length > 0 ? [...item.viagens] : [null];
    for (const v of viagens) {
      const placa = v?.placa ?? null;
      const g = grupos.get(placa) ?? {
        linha: { placa, motorista: null, ctes: 0, peso: 0, volumes: 0, frete: 0 },
        motoristas: [],
      };
      grupos.set(placa, g);
      g.linha.ctes += 1;
      g.linha.peso += item.fato.peso;
      g.linha.volumes += item.fato.volumes;
      g.linha.frete += centavos(item.fato.valorFrete);
      g.motoristas.push(v?.motorista ?? null);
    }
  }
  return [...grupos.values()]
    .map((g) => ({ ...g.linha, frete: reais(g.linha.frete), motorista: maxTexto(g.motoristas) }))
    .sort((a, b) => {
      if (a.placa === null || b.placa === null) return a.placa === null ? 1 : -1;
      return b.ctes - a.ctes || COLLATOR.compare(a.placa, b.placa);
    });
}

// ---------------------------------------------------------------------------------------------
// Aba Prejuízo

export interface PontoPrejuizo {
  ctes: number;
  frete: number;
}

export interface RankingPrejuizo extends PontoPrejuizo {
  nome: string;
  placa: string | null;
}

export interface Prejuizo {
  porDia: (PontoPrejuizo & { dia: string })[];
  porHora: (PontoPrejuizo & { hora: number })[];
  cidades: RankingPrejuizo[];
  pagadores: RankingPrejuizo[];
  motoristas: RankingPrejuizo[];
}

/** Soma o frete em centavos inteiros; `emReais` converte na saída. */
function somar<K>(mapa: Map<K, PontoPrejuizo>, chave: K, frete: number) {
  const p = mapa.get(chave) ?? { ctes: 0, frete: 0 };
  p.ctes += 1;
  p.frete += centavos(frete);
  mapa.set(chave, p);
}

const emReais = <P extends PontoPrejuizo>(p: P): P => ({ ...p, frete: reais(p.frete) });

function topo(mapa: Map<string, PontoPrejuizo>, n: number): RankingPrejuizo[] {
  return [...mapa]
    .map(([nome, p]) => ({ nome, placa: null, ...emReais(p) }))
    .sort((a, b) => b.ctes - a.ctes || COLLATOR.compare(a.nome, b.nome))
    .slice(0, n);
}

/**
 * CT-e prejudicados no período (Q14: mesma janela das outras abas; Q15: só quem saiu).
 * origem: get_romaneio_prejuizo
 */
export function prejuizo(itens: readonly CteComViagens[], ctx: ContextoPorViagem): Prejuizo {
  const dias = new Map<string, PontoPrejuizo>();
  const horas = new Map<number, PontoPrejuizo>();
  const cidades = new Map<string, PontoPrejuizo>();
  const pagadores = new Map<string, PontoPrejuizo>();
  const motoristas = new Map<string, PontoPrejuizo & { motorista: string; placa: string }>();
  for (const item of itens) {
    if (!item.analise.prejudicado) continue;
    const c = item.fato;
    somar(dias, c.dataEmissao, c.valorFrete);
    const primeira = ocorrenciasPenalizantes(c, ctx).reduce((a, b) =>
      b.dataHora < a.dataHora ? b : a,
    );
    somar(horas, horaSp(primeira.dataHora), c.valorFrete);
    somar(cidades, c.cidadeDestino?.trim() || "—", c.valorFrete);
    somar(pagadores, c.pagadorNome?.trim() || "—", c.valorFrete);
    const viagem = [...item.viagens]
      .sort(
        (a, b) =>
          a.dataSaida.localeCompare(b.dataSaida) || COLLATOR.compare(a.romaneio, b.romaneio),
      )
      .find((v) =>
        ocorrenciaNaViagem(c, v, ctx.codigosPrejuizo, ctx.periodo, "prejuizo", ctx.cadastro),
      );
    const motorista = viagem?.motorista ?? "—";
    const placa = viagem?.placa ?? "—";
    const chave = JSON.stringify([motorista, placa]);
    const m = motoristas.get(chave) ?? { motorista, placa, ctes: 0, frete: 0 };
    m.ctes += 1;
    m.frete += centavos(c.valorFrete);
    motoristas.set(chave, m);
  }
  return {
    porDia: [...dias]
      .map(([dia, p]) => ({ dia, ...emReais(p) }))
      .sort((a, b) => a.dia.localeCompare(b.dia)),
    porHora: [...horas]
      .map(([hora, p]) => ({ hora, ...emReais(p) }))
      .sort((a, b) => a.hora - b.hora),
    cidades: topo(cidades, 10),
    pagadores: topo(pagadores, 10),
    motoristas: [...motoristas.values()]
      .map(({ motorista, placa, ctes, frete }) => ({
        nome: motorista,
        placa,
        ctes,
        frete: reais(frete),
      }))
      .sort((a, b) => b.ctes - a.ctes || COLLATOR.compare(a.nome, b.nome))
      .slice(0, 15),
  };
}
