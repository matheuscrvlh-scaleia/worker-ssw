/**
 * Ocorrência efetiva: a que "vale" para o CT-e entre as ocorrências gravadas e as fotos do CT-e
 * (0174, 0013, 036). Entrega/baixa vence o que vier depois; depois, a mais recente; empate, a
 * fonte de maior prioridade.
 */
import { type CatalogoDeCodigos, CODIGOS_ENTREGA, normCodigoOcorr } from "./codes";
import { foraDeQuarentena, maisRecentePrimeiro, type OcorrenciaDoCte } from "./occurrence";
import { nuloSeVazio } from "./text";
import { type DataIso, diaSp } from "./time";

export const FONTES_DA_EFETIVA = ["ssw_036", "bi2_0174", "bi2_0013", "webhook"] as const;
type FonteDaEfetiva = (typeof FONTES_DA_EFETIVA)[number];

/** Prioridade no empate: 036 › 0174 › 0013 › ocorrências gravadas ("webhook"). */
const PRIORIDADE: Record<FonteDaEfetiva, number> = {
  ssw_036: 4,
  bi2_0174: 3,
  bi2_0013: 2,
  webhook: 1,
};

/** Colunas do CT-e que a efetiva lê. */
export interface FontesDaEfetiva {
  dataEmissao: DataIso;
  ultOcorrCodigo0174: string | null;
  ultOcorrDescricao0174: string | null;
  ultOcorrData0174: Date | null;
  ultOcorrLocal0174: string | null;
  ultOcorrInstrucao0174: string | null;
  ultimaOcorrCodigo0013: string | null;
  ultimaOcorrData0013: Date | null;
  ocorr036Codigo: string | null;
  ocorr036Descricao: string | null;
  ocorr036Data: Date | null;
}

/** Colunas `ocorr_efetiva_*` gravadas no CT-e. */
export interface OcorrenciaEfetiva {
  ocorrEfetivaCodigo: string | null;
  ocorrEfetivaDescricao: string | null;
  ocorrEfetivaData: Date | null;
  ocorrEfetivaFonte: FonteDaEfetiva | null;
  ocorrEfetivaLocal: string | null;
}

/** Conclusivo com a lógica de 3 valores do SQL: `null` = código sem `tipo_ssw`. */
type Conclusivo = boolean | null;

interface Candidata {
  codigo: number;
  descricao: string | null;
  dataHora: Date | null;
  fonte: FonteDaEfetiva;
  local: string | null;
  conclusivo: Conclusivo;
}

const SEM_EFETIVA: OcorrenciaEfetiva = {
  ocorrEfetivaCodigo: null,
  ocorrEfetivaDescricao: null,
  ocorrEfetivaData: null,
  ocorrEfetivaFonte: null,
  ocorrEfetivaLocal: null,
};

/**
 * origem: _calc_ocorr_efetiva (+ _trg_ctrcs_calc_ocorr_efetiva, recompute_ocorr_efetiva), sistema atual
 */
export function calcularOcorrenciaEfetiva(
  cte: FontesDaEfetiva,
  ocorrencias: readonly OcorrenciaDoCte[],
  catalogo: CatalogoDeCodigos,
): OcorrenciaEfetiva {
  const emissao = cte.dataEmissao;
  const melhorOutros = melhorCandidata(
    [
      candidata0174(cte, catalogo),
      candidata0013(cte, catalogo),
      melhorOcorrenciaGravada(ocorrencias, emissao, catalogo),
    ].filter((c): c is Candidata => c !== null),
  );
  const c036 = candidata036(cte, catalogo);
  // O 036 não tira uma ENTREGA do lugar com algo que não é entrega.
  const derrubaEntrega =
    c036 !== null &&
    melhorOutros !== null &&
    CODIGOS_ENTREGA.has(melhorOutros.codigo) &&
    !CODIGOS_ENTREGA.has(c036.codigo);
  const vencedora = melhorCandidata(
    [melhorOutros, derrubaEntrega ? null : c036].filter((c): c is Candidata => c !== null),
  );
  if (vencedora === null) return SEM_EFETIVA;
  return {
    ocorrEfetivaCodigo: String(vencedora.codigo),
    ocorrEfetivaDescricao: vencedora.descricao,
    ocorrEfetivaData: vencedora.dataHora,
    ocorrEfetivaFonte: vencedora.fonte,
    ocorrEfetivaLocal: vencedora.local,
  };
}

function conclusivoDe(codigo: number, catalogo: CatalogoDeCodigos): Conclusivo {
  if (CODIGOS_ENTREGA.has(codigo)) return true;
  const tipo = catalogo.get(codigo)?.tipoSsw ?? null;
  return tipo === null ? null : tipo === "BAIXA";
}

/** Ocorrência/foto com dia (Brasília) antes da emissão não entra. */
function passaEmissao(dataHora: Date | null, emissao: DataIso): boolean {
  return dataHora === null || diaSp(dataHora) >= emissao;
}

/** Entre as linhas gravadas o `null` de conclusivo perde também para `false` (true › false › null). */
function melhorOcorrenciaGravada(
  ocorrencias: readonly OcorrenciaDoCte[],
  emissao: DataIso,
  catalogo: CatalogoDeCodigos,
): Candidata | null {
  const rank = (c: Conclusivo) => (c === true ? 2 : c === false ? 1 : 0);
  const [melhor] = foraDeQuarentena(ocorrencias)
    .filter((o) => passaEmissao(o.dataHora, emissao))
    .map((o) => ({ o, conclusivo: conclusivoDe(o.codigo, catalogo) }))
    .sort((a, b) => rank(b.conclusivo) - rank(a.conclusivo) || maisRecentePrimeiro(a.o, b.o));
  if (melhor === undefined) return null;
  return {
    codigo: melhor.o.codigo,
    descricao: melhor.o.descricao ?? catalogo.get(melhor.o.codigo)?.descricao ?? null,
    dataHora: melhor.o.dataHora,
    fonte: "webhook",
    local: null,
    conclusivo: melhor.conclusivo,
  };
}

/** Foto gravada em colunas do CT-e: só existe com data, código e dentro da emissão. */
function candidataDeColuna(
  codigoTexto: string | null,
  dataHora: Date | null,
  emissao: DataIso,
  catalogo: CatalogoDeCodigos,
  montar: (codigo: number) => Pick<Candidata, "fonte" | "descricao" | "local">,
): Candidata | null {
  const codigo = normCodigoOcorr(codigoTexto);
  if (dataHora === null || codigo === null || !passaEmissao(dataHora, emissao)) return null;
  return { codigo, dataHora, conclusivo: conclusivoDe(codigo, catalogo), ...montar(codigo) };
}

function candidata0174(cte: FontesDaEfetiva, catalogo: CatalogoDeCodigos): Candidata | null {
  return candidataDeColuna(
    cte.ultOcorrCodigo0174,
    cte.ultOcorrData0174,
    cte.dataEmissao,
    catalogo,
    (codigo) => ({
      fonte: "bi2_0174",
      // Descrição vazia do 0174 é mantida (só NULL cai no cadastro).
      descricao: cte.ultOcorrDescricao0174 ?? catalogo.get(codigo)?.descricao ?? null,
      local: nuloSeVazio(cte.ultOcorrInstrucao0174) ?? cte.ultOcorrLocal0174,
    }),
  );
}

function candidata0013(cte: FontesDaEfetiva, catalogo: CatalogoDeCodigos): Candidata | null {
  return candidataDeColuna(
    cte.ultimaOcorrCodigo0013,
    cte.ultimaOcorrData0013,
    cte.dataEmissao,
    catalogo,
    (codigo) => ({
      fonte: "bi2_0013",
      descricao: catalogo.get(codigo)?.descricao ?? null,
      local: null,
    }),
  );
}

function candidata036(cte: FontesDaEfetiva, catalogo: CatalogoDeCodigos): Candidata | null {
  return candidataDeColuna(
    cte.ocorr036Codigo,
    cte.ocorr036Data,
    cte.dataEmissao,
    catalogo,
    (codigo) => ({
      fonte: "ssw_036",
      descricao: nuloSeVazio(cte.ocorr036Descricao) ?? catalogo.get(codigo)?.descricao ?? null,
      local: null,
    }),
  );
}

/** Entre fontes, `null` de conclusivo vale `false`: conclusivo › mais recente › prioridade. */
function melhorCandidata(candidatas: readonly Candidata[]): Candidata | null {
  const [melhor] = [...candidatas].sort(
    (a, b) =>
      Number(b.conclusivo === true) - Number(a.conclusivo === true) ||
      compararDataDescNulosPorUltimo(a.dataHora, b.dataHora) ||
      PRIORIDADE[b.fonte] - PRIORIDADE[a.fonte],
  );
  return melhor ?? null;
}

function compararDataDescNulosPorUltimo(a: Date | null, b: Date | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return b.getTime() - a.getTime();
}

/**
 * `status_atual`: descrição da ocorrência gravada mais recente (não é a efetiva; não olha as
 * fotos). Quarentena fica de fora (Q21 do dono). `null` = não mexer no valor atual.
 * origem: sync_status_atual_from_ocorrencia (gatilho, sistema atual)
 */
export function statusAtual(
  ocorrencias: readonly OcorrenciaDoCte[],
  catalogo: CatalogoDeCodigos,
): string | null {
  const [ultima] = foraDeQuarentena(ocorrencias).sort(maisRecentePrimeiro);
  if (ultima === undefined) return null;
  return ultima.descricao ?? catalogo.get(ultima.codigo)?.descricao ?? null;
}
