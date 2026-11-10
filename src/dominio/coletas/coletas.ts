import {
  type EtapaDeColeta,
  type PainelDeColetas,
  type StatusDaLista,
  type StatusDePrazo,
  type TotaisDeColetas,
} from "@erp/shared/contratos/coletas";
import { hojeNoFuso } from "@erp/shared/datas";

import { agrupar } from "../colecoes";
import { btrim } from "../nucleo";
import { compararComNulosNoFim, compararNumero, compararTexto } from "../ordem";

/**
 * Etapa pela situação do SSW (o leitor grava a situação em maiúsculas).
 * origem: vw_coletas.etapa (sistema atual)
 */
export function etapaDaSituacao(situacao: string | null): EtapaDeColeta {
  const s = situacao ?? "";
  if (s.startsWith("CANCEL")) return "cancelada";
  if (s.startsWith("COLETAD")) return "coletada";
  if (s.startsWith("COMAND")) return "comandada";
  return "cadastrada";
}

export interface DadosDoPrazo {
  situacao: string | null;
  limiteEm: Date | null;
  coletadaEm: Date | null;
  situacaoEm: Date | null;
}

/**
 * Prazo da coleta pela regra do SSW (bate com o quadro RESUMO do 050): coletada no prazo se ficou
 * COLETADA até o limite atual; cancelada não entra na conta. Em aberto: vencida, vence hoje (dia
 * no fuso da empresa) ou a vencer.
 * origem: vw_coletas.status_prazo (sistema atual)
 */
export function statusDoPrazo(c: DadosDoPrazo, agora: Date, fuso: string): StatusDePrazo {
  const s = c.situacao ?? "";
  if (s.startsWith("CANCEL")) return "cancelada";
  if (s.startsWith("COLETAD")) {
    if (c.limiteEm === null) return "no_prazo";
    const em = c.coletadaEm ?? c.situacaoEm;
    return em !== null && em <= c.limiteEm ? "no_prazo" : "atrasada";
  }
  if (c.limiteEm === null) return "a_vencer";
  if (c.limiteEm < agora) return "vencida";
  if (hojeNoFuso(fuso, c.limiteEm) === hojeNoFuso(fuso, agora)) return "vence_hoje";
  return "a_vencer";
}

/** Coleta já com etapa, prazo e o tipo do CT-e gerado. */
export interface ColetaDaTela {
  unidade: string;
  numero: number;
  tipo: string;
  etapa: EtapaDeColeta;
  statusPrazo: StatusDePrazo;
  diaCadastro: string;
  cadastradaEm: Date | null;
  limiteEm: Date | null;
  solicitante: string | null;
  remetenteNome: string | null;
  destinatarioNome: string | null;
  notasFiscais: string | null;
  observacao: string | null;
  placa: string | null;
  cteSigla: string | null;
  cteNumero: string | null;
  cteTipoDocumento: string | null;
  prejudicadaHorario: boolean;
}

const aberta = (c: Pick<ColetaDaTela, "etapa">) =>
  c.etapa === "cadastrada" || c.etapa === "comandada";

const CASA_STATUS: Record<StatusDaLista, (c: ColetaDaTela) => boolean> = {
  todas: () => true,
  coletadas: (c) => c.etapa === "coletada",
  no_prazo: (c) => c.statusPrazo === "no_prazo",
  atrasadas: (c) => c.statusPrazo === "atrasada",
  abertas: aberta,
  cadastradas: (c) => c.etapa === "cadastrada",
  comandadas: (c) => c.etapa === "comandada",
  vencidas: (c) => c.statusPrazo === "vencida",
  vence_hoje: (c) => c.statusPrazo === "vence_hoje",
  a_vencer: (c) => c.statusPrazo === "a_vencer",
  canceladas: (c) => c.etapa === "cancelada",
  com_ctrc: (c) => c.cteNumero !== null,
  prejudicadas: (c) => c.prejudicadaHorario,
};

function contarTotais(coletas: readonly ColetaDaTela[]): TotaisDeColetas {
  const n = (status: StatusDaLista) => coletas.filter(CASA_STATUS[status]).length;
  return {
    total: coletas.length,
    coletadas: n("coletadas"),
    noPrazo: n("no_prazo"),
    atrasadas: n("atrasadas"),
    canceladas: n("canceladas"),
    abertas: n("abertas"),
    cadastradas: n("cadastradas"),
    comandadas: n("comandadas"),
    vencidas: n("vencidas"),
    venceHoje: n("vence_hoje"),
    aVencer: n("a_vencer"),
    comCtrc: n("com_ctrc"),
    prejudicadas: n("prejudicadas"),
    reversas: coletas.filter((c) => c.tipo === "REVERSA").length,
  };
}

/**
 * Cards e agrupamentos da tela (as opções, a posição e a cobertura vêm do repositório).
 * origem: coletas_painel (sistema atual)
 */
export function calcularPainelDeColetas(
  coletas: readonly ColetaDaTela[],
): Pick<PainelDeColetas, "totais" | "porSolicitante" | "porUnidade" | "porDia" | "porTipoCtrc"> {
  const resumo = (grupo: readonly ColetaDaTela[]) => {
    const t = contarTotais(grupo);
    return {
      total: t.total,
      coletadas: t.coletadas,
      noPrazo: t.noPrazo,
      atrasadas: t.atrasadas,
      abertas: t.abertas,
    };
  };
  const comCte = coletas.filter((c) => c.cteNumero !== null);
  return {
    totais: contarTotais(coletas),
    porSolicitante: [...agrupar(coletas, (c) => c.solicitante ?? "")]
      .map(([solicitante, grupo]) => ({ solicitante, ...resumo(grupo) }))
      .sort((a, b) => b.total - a.total || compararTexto(a.solicitante, b.solicitante)),
    porUnidade: [...agrupar(coletas, (c) => c.unidade)]
      .map(([unidade, grupo]) => {
        const t = contarTotais(grupo);
        return {
          unidade,
          ...resumo(grupo),
          vencidas: t.vencidas,
          canceladas: t.canceladas,
        };
      })
      .sort((a, b) => b.total - a.total || compararTexto(a.unidade, b.unidade)),
    porDia: [...agrupar(coletas, (c) => c.diaCadastro)]
      .map(([dia, grupo]) => {
        const t = contarTotais(grupo);
        return { dia, total: t.total, noPrazo: t.noPrazo, atrasadas: t.atrasadas };
      })
      .sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0)),
    // Desempate pelo tipo (Q07 do dono): não muda contagem.
    porTipoCtrc: [...agrupar(comCte, (c) => c.cteTipoDocumento ?? "")]
      .map(([tipoDocumento, grupo]) => ({
        tipoDocumento,
        coletas: grupo.length,
        ctes: new Set(
          grupo.filter((c) => c.cteSigla !== null).map((c) => `${c.cteSigla}|${c.cteNumero}`),
        ).size,
      }))
      .sort((a, b) => b.coletas - a.coletas || compararTexto(a.tipoDocumento, b.tipoDocumento)),
  };
}

/**
 * Busca da lista: número da coleta, CT-e gerado, placa (igual, sem caixa) ou trecho de
 * remetente, destinatário, notas ou observação. `%` e `_` são texto (Q10 do dono).
 * origem: coletas_lista (sistema atual)
 */
export function casaBusca(c: ColetaDaTela, busca: string): boolean {
  const t = termosDaBusca(busca);
  if (t === null) return true;
  const contem = (valor: string | null) => valor?.toLowerCase().includes(t.texto) ?? false;
  return (
    String(c.numero) === t.numero ||
    c.cteNumero === t.cte ||
    c.placa?.toLowerCase() === t.texto ||
    [c.remetenteNome, c.destinatarioNome, c.notasFiscais, c.observacao].some(contem)
  );
}

/**
 * Termos da busca: número da coleta sem zeros à esquerda, CT-e só com dígitos e sem zeros, e o
 * texto em minúsculas (placa igual; remetente, destinatário, notas e observação contêm). Vazia =
 * sem busca. A lista da API usa os mesmos termos no SQL.
 */
export function termosDaBusca(
  busca: string,
): { numero: string; cte: string; texto: string } | null {
  const b = btrim(busca);
  if (b === "") return null;
  return {
    numero: b.replace(/^0+/, ""),
    cte: b.replace(/\D/g, "").replace(/^0+/, ""),
    texto: b.toLowerCase(),
  };
}

const tempo = (d: Date | null) => d?.getTime() ?? null;

/**
 * Abertas primeiro, pela que vence antes; depois as mais recentes; empate por unidade e número
 * (a chave da coleta). A lista da API ordena igual no SQL.
 */
function compararColetas(a: ColetaDaTela, b: ColetaDaTela): number {
  return (
    Number(aberta(b)) - Number(aberta(a)) ||
    compararComNulosNoFim(
      aberta(a) ? tempo(a.limiteEm) : null,
      aberta(b) ? tempo(b.limiteEm) : null,
      compararNumero,
      "asc",
    ) ||
    compararComNulosNoFim(tempo(a.cadastradaEm), tempo(b.cadastradaEm), compararNumero, "desc") ||
    compararTexto(a.unidade, b.unidade) ||
    a.numero - b.numero
  );
}

/**
 * Lista do card: status, busca, ordem e paginação. A API pagina esta mesma regra no banco
 * (coletas/repositorio.ts); aqui fica a forma em TypeScript, que os testes usam como referência.
 * origem: coletas_lista (sistema atual)
 */
export function listarColetas<C extends ColetaDaTela>(
  coletas: readonly C[],
  pedido: { status: StatusDaLista; busca: string; pagina: number; tamanho: number },
): { linhas: C[]; total: number } {
  const filtradas = coletas
    .filter((c) => CASA_STATUS[pedido.status](c) && casaBusca(c, pedido.busca))
    .sort(compararColetas);
  const inicio = (pedido.pagina - 1) * pedido.tamanho;
  return { linhas: filtradas.slice(inicio, inicio + pedido.tamanho), total: filtradas.length };
}
