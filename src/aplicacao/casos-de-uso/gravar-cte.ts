/**
 * Gravação de CT-e pela ingestão — arquivos do SSW, XML, BI2 e webhook —, sempre pelo núcleo
 * (`prepararGravacaoDoCte`): trava do BI2, data mínima, derivados, "não grava linha igual" e
 * histórico de previsão na mesma transação.
 */
import {
  type FonteDaEscrita,
  type MotivoDoDescarte,
  type OcorrenciaDoCte,
  prepararGravacaoDoCte,
} from "@erp/dominio/nucleo";

import { type CamposDoCte, type CteDaIngestao } from "../regras";
import { type CadastrosDoNucleo, type RepositorioCteNucleo } from "./portas";

/** Linha nova de `ctes` com os valores padrão do banco; os campos vêm por cima. */
export function cteEmBranco(empresaId: string, id: string, agora: Date): CteDaIngestao {
  return {
    id,
    empresaId,
    sigla: "",
    numero: "",
    chave: null,
    siglaCte: null,
    numeroCte: null,
    tipoDocumento: null,
    tipoDocumento455: null,
    duplicadoDe: null,
    dataEmissao: "", // sempre vem nos campos do CT-e novo (sem emissão não há CT-e)
    dataEmbarque: null,
    dataEntregaRealizada: null,
    canceladoEm: null,
    dataConclusaoEfetiva: null,
    unidadeId: null,
    parceiroId: null,
    equipeId: null,
    remetente: null,
    cnpjRemetente: null,
    destinatario: null,
    cnpjDestinatario: null,
    pagadorNome: null,
    pagadorCnpj: null,
    pagadorCnpjDigitos: null,
    parceiroCnpj: null,
    parceiroNome: null,
    cidadeDestino: null,
    ufDestino: null,
    bairroDestino: null,
    logradouroDestino: null,
    numeroEnderecoDestino: null,
    complementoDestino: null,
    cepDestinatario: null,
    setor: null,
    setorDestino: null,
    filial: null,
    unidadeOrigem: null,
    unidadeDestino: null,
    unidadeAtual: null,
    localizacaoAtual: null,
    filialEfetiva: null,
    unidadeCidade: null,
    unidadeUf: null,
    chaveNfe: null,
    numeroNf: null,
    serieNf: null,
    peso: null,
    volumes: null,
    valorFrete: null,
    valorMercadoria: null,
    tde: null,
    nroManifesto: null,
    primeiroManifesto: null,
    ultimoManifesto: null,
    prazoEntrega: null,
    prazoOrigem: "proprio",
    prazoContratadoDias: null,
    prazoFonte: null,
    dataBasePrazo: null,
    dataPrevistaEntrega: null,
    previsaoSswData: null,
    previsaoSswFonte: null,
    previsaoSswDataBase: null,
    prazoPadraoDias: null,
    prazoPadraoData: null,
    performanceDias: null,
    noPrazo: null,
    responsabilidadeCliente: null,
    fontePerformance: null,
    atrasoDias: null,
    statusAtual: null,
    motoristaNome: null,
    ajudanteNome: null,
    placaColeta: null,
    placaEntrega: null,
    comprovanteEscaneado: null,
    comprovanteEscaneadoEm: null,
    ultimaOcorrCodigo0013: null,
    ultimaOcorrData0013: null,
    ultOcorrCodigo0174: null,
    ultOcorrDescricao0174: null,
    ultOcorrData0174: null,
    ultOcorrLocal0174: null,
    ultOcorrInstrucao0174: null,
    ocorr036Codigo: null,
    ocorr036Descricao: null,
    ocorr036Data: null,
    ocorrEfetivaCodigo: null,
    ocorrEfetivaCodigoNum: null,
    ocorrEfetivaDescricao: null,
    ocorrEfetivaData: null,
    ocorrEfetivaFonte: null,
    ocorrEfetivaLocal: null,
    canceladoMesmoDia: false,
    foraUniverso: false,
    camposSsw: [],
    criadoEm: agora,
    atualizadoEm: agora,
  };
}

function igual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => igual(v, b[i]));
  }
  return a === b;
}

/** Só as colunas que mudaram (o UPDATE não regrava o que está igual). */
export function camposQueMudaram(antigo: CteDaIngestao, novo: CteDaIngestao): CamposDoCte {
  const saida: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(novo)) {
    if (campo === "id" || campo === "empresaId" || campo === "criadoEm") continue;
    if (!igual(antigo[campo as keyof CteDaIngestao], valor)) saida[campo] = valor;
  }
  return saida;
}

export type ResultadoDaGravacao =
  | { tipo: "descartado"; motivo: MotivoDoDescarte }
  | { tipo: "igual" | "gravado"; cte: CteDaIngestao };

/**
 * Aplica `campos` no CT-e já gravado pelo núcleo e grava a diferença (com `atualizado_em`) e o
 * histórico de previsão. `fonte` decide o que o BI2 pode mudar (padrão: arquivos do SSW, webhook,
 * XML); `ajustar` mexe no resultado do núcleo antes de gravar (ex.: `campos_ssw`). Única gravação
 * de CT-e existente da ingestão (arquivos, XML, BI2 e webhook).
 */
export async function regravarCte(
  repo: RepositorioCteNucleo,
  cad: CadastrosDoNucleo,
  antigo: CteDaIngestao,
  campos: CamposDoCte,
  ocorrencias: readonly OcorrenciaDoCte[],
  agora: Date,
  opcoes: { fonte?: FonteDaEscrita; ajustar?: (cte: CteDaIngestao) => CamposDoCte } = {},
): Promise<ResultadoDaGravacao> {
  const g = prepararGravacaoDoCte({
    antigo,
    novo: { ...antigo, ...campos },
    fonte: opcoes.fonte ?? "outra",
    contexto: { ...cad, ocorrencias },
  });
  if (g.tipo === "descartar") return { tipo: "descartado", motivo: g.motivo };
  const final = opcoes.ajustar ? { ...g.cte, ...opcoes.ajustar(g.cte) } : g.cte;
  const mudou = camposQueMudaram(antigo, final);
  if (Object.keys(mudou).length === 0) return { tipo: "igual", cte: antigo };
  await repo.atualizarCte(antigo.id, { ...mudou, atualizadoEm: agora });
  if (g.trocaDePrevisao) await repo.registrarTrocaDePrevisao(antigo.id, g.trocaDePrevisao);
  return { tipo: "gravado", cte: { ...final, atualizadoEm: agora } };
}

/**
 * Cria um CT-e pelo núcleo (data mínima de emissão e "o BI2 não cria" valem aqui). CT-e que já
 * existe com a mesma sigla e número (corrida entre duas gravações) é erro.
 */
export async function criarCte(
  repo: RepositorioCteNucleo,
  cad: CadastrosDoNucleo,
  novo: CteDaIngestao,
  fonte: FonteDaEscrita,
): Promise<ResultadoDaGravacao> {
  const g = prepararGravacaoDoCte({
    antigo: null,
    novo,
    fonte,
    contexto: { ...cad, ocorrencias: [] },
  });
  if (g.tipo === "descartar") return { tipo: "descartado", motivo: g.motivo };
  const [inserido] = await repo.inserirCtes([g.cte]);
  if (!inserido) throw new Error(`CT-e ${novo.sigla} ${novo.numero} já existe.`);
  return { tipo: "gravado", cte: inserido };
}
