/*
 * Banco falso dos jobs: implementa os repositórios do worker sobre arrays (sem SQL nem
 * RLS) e registra o contexto de cada transação.
 */
import { randomUUID } from "node:crypto";

import { type ContextoBanco } from "@erp/db";
import {
  type CodigoNovo,
  CONFIGURACAO_PADRAO,
  type OcorrenciaDoCte,
  type TrocaDePrevisao,
} from "@erp/domain/core";
import { chaveDaColeta, type ColetaParaGravar } from "@erp/domain/pickups/write-050";
import { CATALOGO_FR } from "@erp/domain/tests/core";
import { type IntegracaoDaIngestao } from "@erp/shared/ingestion";

import { type CadastrosDoNucleo, cteEmBranco } from "../aplicacao/casos-de-uso";
import { type CteDaIngestao } from "../aplicacao/regras";
import { type SincronizacaoNova } from "../fontes/bi2/job";
import { type IntegracaoGravada, type VerificacaoDaIntegracao } from "../fontes/comum/integracao";
import { type OcorrenciaDoWebhook, type ResultadoDoEvento } from "../fontes/webhook/job";
import { type LimitesDaIngestaoSsw } from "../jobs/manutencao/job";
import { type ExecutorDoWorker, type RepositoriosDoWorker } from "../jobs/registro";
import { estadoFalso, repositorioFalso } from ".";
import { ProjecoesFalsas } from "./projecoes-falsas";

export const EMPRESA = "0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d";

export function cteGravado(extra: Partial<CteDaIngestao> = {}): CteDaIngestao {
  return {
    ...cteEmBranco(EMPRESA, randomUUID(), new Date("2026-11-01T12:00:00Z")),
    sigla: "CAP",
    numero: "33214",
    dataEmissao: "2026-11-01",
    ...extra,
  };
}

export class BancoFalso {
  contextos: ContextoBanco[] = [];
  ctes: CteDaIngestao[] = [];
  ocorrencias: (OcorrenciaDoCte & OcorrenciaDoWebhook)[] = [];
  trocas: (TrocaDePrevisao & { cteId: string })[] = [];
  bruto = new Map<string, { dataAlvo: string; payload: Record<string, string> }>();
  sincronizacoes: SincronizacaoNova[] = [];
  eventos = new Map<
    string,
    { payload: unknown; autenticado?: boolean; resultado: ResultadoDoEvento | null }
  >();
  codigosCadastrados: CodigoNovo[] = [];
  coletas = new Map<string, ColetaParaGravar>();
  apelidos = new Map<string, string>();
  integracoes = new Map<IntegracaoDaIngestao, IntegracaoGravada>();
  verificacoes: (VerificacaoDaIntegracao & { tipo: string })[] = [];
  empresas: { id: string; integracoes: IntegracaoDaIngestao[] }[] = [];
  contexto: CadastrosDoNucleo = {
    catalogo: CATALOGO_FR,
    filiais: [{ sigla: "CAP", cidade: "CAMPINAS", uf: "SP", propria: true }],
    regrasDePrazo: [],
    config: CONFIGURACAO_PADRAO,
    cnpjsProprios: [],
    dominioSsw: "FRT",
  };
  /** Estado da ingestão por arquivo (falso do pacote `@erp/ingestao`). */
  ingestao = estadoFalso();
  /** Limites recebidos pela retenção da ingestão. */
  retencoes: Date[] = [];
  /** Limites recebidos pela retenção da ingestão SSW/BI2. */
  retencoesSsw: LimitesDaIngestaoSsw[] = [];
  projecoes = new ProjecoesFalsas();
  /** Faz a próxima transação falhar com este erro. */
  falharCom: Error | null = null;

  readonly executar: ExecutorDoWorker = async (contexto, fn) => {
    this.contextos.push(contexto);
    if (this.falharCom) {
      const erro = this.falharCom;
      this.falharCom = null;
      throw erro;
    }
    return fn(this.repositorios());
  };

  private repositorios(): RepositoriosDoWorker {
    return {
      agendamentos: {
        empresasAtivas: () =>
          Promise.resolve(this.empresas.map(({ id }) => ({ id, fuso: "America/Sao_Paulo" }))),
        empresasComIntegracao: (tipo) =>
          Promise.resolve(
            this.empresas.filter((e) => e.integracoes.includes(tipo)).map(({ id }) => ({ id })),
          ),
      },
      manutencao: {
        apagarIngestaoSswAntiga: (limites) => {
          this.retencoesSsw.push(limites);
          return Promise.resolve({});
        },
      },
      slaArquivos: {
        feriados: () => Promise.resolve([]),
        candidatos: () => Promise.resolve([]),
        gravar: () => Promise.resolve(),
      },
      integracoes: {
        ler: (_empresa, tipo) => Promise.resolve(this.integracoes.get(tipo) ?? null),
        registrarVerificacao: (_empresa, tipo, v) => {
          this.verificacoes.push({ ...v, tipo });
          return Promise.resolve();
        },
      },
      cteNucleo: {
        cadastrosDoNucleo: () => Promise.resolve(this.contexto),
        ocorrenciasDosCtes: (ids) =>
          Promise.resolve(
            new Map(ids.map((id) => [id, this.ocorrencias.filter((o) => o.cteId === id)])),
          ),
        atualizarCte: (id, campos) => {
          this.ctes = this.ctes.map((c) => (c.id === id ? { ...c, ...campos } : c));
          return Promise.resolve();
        },
        inserirCtes: (novos) => {
          const entraram = novos.filter(
            (n) => !this.ctes.some((c) => c.sigla === n.sigla && c.numero === n.numero),
          );
          this.ctes.push(...entraram);
          return Promise.resolve(entraram);
        },
        registrarTrocaDePrevisao: (cteId, troca) => {
          this.trocas.push({ ...troca, cteId });
          return Promise.resolve();
        },
      },
      bi2: {
        ctesPorNumeros: (numeros) =>
          Promise.resolve(this.ctes.filter((c) => numeros.includes(c.numero))),
        gravarBruto: (_codigo, dataAlvo, linhas) => {
          for (const l of linhas) this.bruto.set(l.numero, { dataAlvo, payload: l.payload });
          return Promise.resolve();
        },
        registrarSincronizacao: (s) => {
          this.sincronizacoes.push(s);
          return Promise.resolve();
        },
      },
      webhook: {
        payloadDoEvento: (id) => {
          const e = this.eventos.get(id);
          return Promise.resolve(
            e ? { payload: e.payload, autenticado: e.autenticado ?? true } : null,
          );
        },
        cnpjsAceitos: () =>
          Promise.resolve(this.integracoes.get("ssw_webhook")?.parametros.cnpjs_aceitos ?? []),
        atualizarEvento: (id, resultado) => {
          const e = this.eventos.get(id);
          if (e) e.resultado = resultado;
          return Promise.resolve();
        },
        ctePorSiglaENumero: (sigla, numero) =>
          Promise.resolve(this.ctes.find((c) => c.sigla === sigla && c.numero === numero) ?? null),
        ctesPorNumero: (numero) => Promise.resolve(this.ctes.filter((c) => c.numero === numero)),
        filialPorCidade: (cidade) => Promise.resolve(this.apelidos.get(cidade) ?? null),
        cadastrarCodigo: (codigo) => {
          this.codigosCadastrados.push(codigo);
          return Promise.resolve();
        },
        gravarOcorrencia: (o) => {
          const existente = this.ocorrencias.find(
            (x) =>
              x.cteId === o.cteId &&
              x.codigo === o.codigo &&
              x.dataHora.getTime() === o.dataHora.getTime(),
          );
          if (existente) {
            Object.assign(existente, o);
            return Promise.resolve(existente.id);
          }
          const id = randomUUID();
          this.ocorrencias.push({ ...o, id, origem: "webhook", criadoEm: new Date() });
          return Promise.resolve(id);
        },
      },
      ingestao: () => repositorioFalso(this.ingestao),
      retencaoDaIngestao: {
        apagarLinhasAplicadasAntesDe: (limite) => this.apagou(limite),
        apagarErrosAntesDe: (limite) => this.apagou(limite),
        apagarArquivosCiclosEAplicacoesAntesDe: (limite) => this.apagou(limite),
        apagarXmlAntesDe: (limite) => this.apagou(limite),
        apagarOrfaosResolvidosAntesDe: (limite) => this.apagou(limite),
        apagarSincronizacoesAntesDe: (limite) => this.apagou(limite),
        apagar038Superadas: (limite) => this.apagou(limite),
      },
      projecoesRomaneio: this.projecoes,
      coletas050: {
        jaGravadas: (_empresa, chaves) =>
          Promise.resolve(
            chaves.flatMap((c) => {
              const g = this.coletas.get(chaveDaColeta(c));
              return g ? [g] : [];
            }),
          ),
        gravar: (_empresa, coletas) => {
          for (const c of coletas) this.coletas.set(chaveDaColeta(c), c);
          return Promise.resolve();
        },
      },
    };
  }

  private apagou(limite: Date) {
    this.retencoes.push(limite);
    return Promise.resolve(0);
  }
}
