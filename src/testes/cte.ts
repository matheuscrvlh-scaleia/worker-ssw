/** CT-e completo (todas as colunas de `ctes`) com valores neutros, para os testes da ingestão. */
import { cte } from "@erp/dominio/testes/nucleo";

import { type CteDaIngestao, type LinhaGuardada } from "../aplicacao/regras";

export const EMPRESA = "00000000-0000-4000-8000-000000000001";

export function cteDeTeste(extra: Partial<CteDaIngestao> = {}): CteDaIngestao {
  return {
    ...cte(),
    id: "00000000-0000-4000-8000-0000000000c1",
    empresaId: EMPRESA,
    sigla: "CAP",
    numero: "33214",
    chave: null,
    siglaCte: null,
    numeroCte: null,
    tipoDocumento: null,
    tipoDocumento455: null,
    unidadeId: null,
    parceiroId: null,
    equipeId: null,
    remetente: null,
    cnpjRemetente: null,
    destinatario: null,
    cnpjDestinatario: null,
    pagadorNome: null,
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
    unidadeOrigem: null,
    localizacaoAtual: null,
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
    performanceDias: null,
    noPrazo: null,
    responsabilidadeCliente: null,
    fontePerformance: null,
    atrasoDias: null,
    motoristaNome: null,
    ajudanteNome: null,
    placaColeta: null,
    placaEntrega: null,
    comprovanteEscaneado: null,
    comprovanteEscaneadoEm: null,
    atualizadoEm: new Date("2026-11-03T10:00:00Z"),
    ...extra,
  };
}

let sequencia = 0;

export function linha<R>(dados: R, importadoEm: string, loteId = "lote-1"): LinhaGuardada<R> {
  sequencia++;
  return { id: sequencia, loteId, importadoEm: new Date(importadoEm), dados };
}
