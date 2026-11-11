/**
 * Job `processar-webhook-ssw`: processa um evento do webhook SSW2181 já autenticado e gravado pela API
 * (`ssw_webhook_eventos`). Casa o CT-e por sigla + número (sem sigla, a série vigente — Q02 do
 * dono), cria o CT-e só nas condições do anti-fantasma, grava a ocorrência e recalcula o CT-e pelo
 * núcleo. O resultado volta para o evento (o que a tela Ingestão SSW mostra).
 * Especificação: docs/regras/06-ingestao.md §3.17.
 */
import { randomUUID } from "node:crypto";

import {
  cnpjsAceitosDosParametros,
  cnpjTransportadora,
  cnpjTransportadoraAceito,
  cteVigente,
  emissaoDoCteDoWebhook,
  type EventoSsw2181,
  lerEventoSsw2181,
  podeCriarCteDoWebhook,
} from "@erp/dominio/ingestao/webhook-ssw";
import {
  cidadeDoComplemento,
  CODIGO_CHEGADA_NA_UNIDADE,
  type CodigoNovo,
  codigoRecebidoSemCadastro,
  filiaisProprias,
  montarCatalogo,
  prepararOcorrencia,
  type Responsavel,
} from "@erp/dominio/nucleo";
import { filaDoJob } from "@erp/shared/ingestao";
import { z } from "@erp/shared/zod";

import {
  type CadastrosDoNucleo,
  criarCte,
  cteEmBranco,
  regravarCte,
  type RepositorioCteNucleo,
} from "../../aplicacao/casos-de-uso";
import { type CteDaIngestao } from "../../aplicacao/regras";
import { definirJob } from "../../jobs/registro";

export interface ResultadoDoEvento {
  statusHttp: number;
  motivoRejeicao: string | null;
  erroProcessamento: string | null;
  cteId: string | null;
  ocorrenciaId: string | null;
}

export interface OcorrenciaDoWebhook {
  cteId: string;
  codigo: number;
  descricao: string | null;
  complemento: string | null;
  dataHora: Date;
  filial: string | null;
  protocoloSsw: string;
  responsavel: Responsavel;
  penaliza: boolean;
  quarentena: boolean;
}

export interface RepositorioWebhook {
  payloadDoEvento(eventoId: string): Promise<{ payload: unknown; autenticado: boolean } | null>;
  /** `parametros.cnpjs_aceitos` da integração do webhook, como está agora. */
  cnpjsAceitos(): Promise<unknown>;
  atualizarEvento(eventoId: string, resultado: ResultadoDoEvento): Promise<void>;
  ctePorSiglaENumero(sigla: string, numero: string): Promise<CteDaIngestao | null>;
  ctesPorNumero(numero: string): Promise<CteDaIngestao[]>;
  /** Sigla da filial pelo nome da cidade (`filiais_apelidos`, igualdade exata). */
  filialPorCidade(cidade: string): Promise<string | null>;
  cadastrarCodigo(codigo: CodigoNovo): Promise<void>;
  /** Upsert por (CT-e, código, data/hora): o mesmo evento reenviado atualiza a linha. */
  gravarOcorrencia(ocorrencia: OcorrenciaDoWebhook): Promise<string>;
}

export const dadosDoWebhook = z.object({
  empresaId: z.uuid(),
  eventoId: z.uuid(),
  /** Protocolo devolvido ao SSW na recepção, gravado na ocorrência. */
  protocolo: z.string().min(1).max(16),
});

export const SEM_VINCULO = "ctrc_desconhecido";

export const jobWebhookSsw = definirJob({
  nome: "processar-webhook-ssw",
  fila: filaDoJob("processar-webhook-ssw"),
  escopo: "empresa",
  dados: dadosDoWebhook,
  agendamento: null,
  async processar({ executar, agora, log }, { empresaId, eventoId, protocolo }) {
    try {
      const resultado = await executar(({ webhook, cteNucleo }) =>
        processarEvento(webhook, cteNucleo, { empresaId, eventoId, protocolo }, agora()),
      );
      log.info({ eventoId, status: resultado?.statusHttp }, "evento do webhook processado");
      return resultado;
    } catch (erro) {
      // A transação voltou: marca o erro no evento (a tela mostra) e deixa o BullMQ tentar de novo.
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      await executar(({ webhook }) =>
        webhook.atualizarEvento(eventoId, {
          statusHttp: 500,
          motivoRejeicao: "erro_gravando_ocorrencia",
          erroProcessamento: mensagem.slice(0, 2000),
          cteId: null,
          ocorrenciaId: null,
        }),
      );
      throw erro;
    }
  },
});

/** Processa e grava o resultado no evento; `null` = evento não existe mais (retenção). */
export async function processarEvento(
  webhook: RepositorioWebhook,
  repo: RepositorioCteNucleo,
  { empresaId, eventoId, protocolo }: z.output<typeof dadosDoWebhook>,
  agora: Date,
): Promise<ResultadoDoEvento | null> {
  const gravado = await webhook.payloadDoEvento(eventoId);
  if (gravado === null) return null;
  const resultado =
    (await conferirOrigem(webhook, gravado)) ??
    (await aplicarEvento(webhook, repo, { empresaId, payload: gravado.payload, protocolo }, agora));
  await webhook.atualizarEvento(eventoId, resultado);
  return resultado;
}

/**
 * Só vira dado o evento autenticado (na recepção ou no reprocesso pelo resumo do token) e de
 * CNPJ aceito pela lista atual da integração; o resto volta como recusa.
 */
async function conferirOrigem(
  webhook: RepositorioWebhook,
  gravado: { payload: unknown; autenticado: boolean },
): Promise<ResultadoDoEvento | null> {
  const recusa = (motivo: string, erro: string): ResultadoDoEvento => ({
    statusHttp: 401,
    motivoRejeicao: motivo,
    erroProcessamento: erro,
    cteId: null,
    ocorrenciaId: null,
  });
  if (!gravado.autenticado) {
    return recusa("token_incorreto", "Evento sem token conferido: não é processado.");
  }
  const cnpj = cnpjTransportadora(gravado.payload);
  if (!cnpjTransportadoraAceito(cnpj, cnpjsAceitosDosParametros(await webhook.cnpjsAceitos()))) {
    return recusa("cnpj_nao_autorizado", "CNPJ da transportadora fora da lista aceita.");
  }
  return null;
}

const semVinculo = (motivo: string, cteId: string | null = null): ResultadoDoEvento => ({
  statusHttp: 202,
  motivoRejeicao: motivo,
  erroProcessamento: null,
  cteId,
  ocorrenciaId: null,
});

/** origem: processarOcorrenciaSsw (src/features/ssw/server/webhook-process.server.ts) */
export async function aplicarEvento(
  webhook: RepositorioWebhook,
  repo: RepositorioCteNucleo,
  { empresaId, payload, protocolo }: { empresaId: string; payload: unknown; protocolo: string },
  agora: Date,
): Promise<ResultadoDoEvento> {
  const lido = lerEventoSsw2181(payload);
  if (lido.tipo === "falha") {
    return {
      ...semVinculo(lido.motivo),
      statusHttp: lido.status,
      erroProcessamento: lido.descricao,
    };
  }
  const evento = lido.evento;
  const cad = await repo.cadastrosDoNucleo();

  let cte = await localizarCte(webhook, evento);
  if (cte === null) {
    if (!podeCriarCteDoWebhook(evento) || evento.sigla === null) return semVinculo(SEM_VINCULO);
    const criado = await criarCte(
      repo,
      cad,
      {
        ...cteEmBranco(empresaId, randomUUID(), agora),
        sigla: evento.sigla,
        numero: evento.numero,
        dataEmissao: emissaoDoCteDoWebhook(evento),
        statusAtual: evento.descricao,
        chaveNfe: evento.chaveNfe,
        numeroNf: evento.numeroNfe > 0 ? evento.numeroNfe : null,
        serieNf: evento.serieNfe,
        cnpjRemetente: evento.cnpjRemetente,
      },
      "outra",
    );
    // CT-e emitido antes da data mínima não entra: o evento fica registrado sem vínculo.
    if (criado.tipo === "descartado") return semVinculo(criado.motivo);
    cte = criado.cte;
  }

  const catalogo = await garantirCodigo(webhook, cad, evento);
  const preparada = prepararOcorrencia({
    ocorrencia: {
      codigo: evento.codigo,
      dataHora: evento.dataHora,
      origem: "webhook",
      responsavel: null,
      quarentena: false,
    },
    cte,
    catalogo,
    empresa: {
      dominioSsw: cad.dominioSsw,
      filiaisProprias: new Set(filiaisProprias(cad.filiais)),
    },
    trackingdanfe: null,
  });
  if (preparada.tipo === "descartar") return semVinculo(preparada.motivo, cte.id);

  const filial =
    evento.codigo === CODIGO_CHEGADA_NA_UNIDADE ? await filialDoComplemento(webhook, evento) : null;
  const ocorrenciaId = await webhook.gravarOcorrencia({
    cteId: cte.id,
    codigo: evento.codigo,
    descricao: evento.descricao,
    complemento: evento.complemento,
    dataHora: evento.dataHora,
    filial,
    protocoloSsw: protocolo,
    responsavel: preparada.responsavel,
    penaliza: preparada.penaliza,
    quarentena: preparada.quarentena,
  });

  const ocorrencias = (await repo.ocorrenciasDosCtes([cte.id])).get(cte.id) ?? [];
  await regravarCte(repo, { ...cad, catalogo }, cte, dadosDaNota(cte, evento), ocorrencias, agora, {
    ocorrenciasMudaram: true,
  });
  return {
    statusHttp: 200,
    motivoRejeicao: null,
    erroProcessamento: null,
    cteId: cte.id,
    ocorrenciaId,
  };
}

async function localizarCte(
  webhook: RepositorioWebhook,
  evento: EventoSsw2181,
): Promise<CteDaIngestao | null> {
  if (evento.sigla !== null) return webhook.ctePorSiglaENumero(evento.sigla, evento.numero);
  return cteVigente(await webhook.ctesPorNumero(evento.numero));
}

/** Código fora do catálogo entra pendente de classificação (garantir_codigo_ocorrencia). */
async function garantirCodigo(
  webhook: RepositorioWebhook,
  cad: CadastrosDoNucleo,
  evento: EventoSsw2181,
) {
  if (cad.catalogo.has(evento.codigo)) return cad.catalogo;
  const novo = codigoRecebidoSemCadastro(evento.codigo, evento.descricao);
  if (novo === null) return cad.catalogo;
  await webhook.cadastrarCodigo(novo);
  return montarCatalogo([...cad.catalogo.values(), novo]);
}

async function filialDoComplemento(webhook: RepositorioWebhook, evento: EventoSsw2181) {
  const cidade = cidadeDoComplemento(evento.complemento);
  return cidade === null ? null : webhook.filialPorCidade(cidade);
}

/**
 * Chave da NF-e e CNPJ do remetente (da chave) sempre sobrescrevem; número e série da NF só
 * preenchem vazio.
 */
function dadosDaNota(cte: CteDaIngestao, evento: EventoSsw2181): Partial<CteDaIngestao> {
  return {
    ...(evento.chaveNfe === null ? {} : { chaveNfe: evento.chaveNfe }),
    ...(evento.cnpjRemetente === null ? {} : { cnpjRemetente: evento.cnpjRemetente }),
    ...(cte.numeroNf === null && evento.numeroNfe > 0 ? { numeroNf: evento.numeroNfe } : {}),
    ...(cte.serieNf === null && evento.serieNfe !== null ? { serieNf: evento.serieNfe } : {}),
  };
}
