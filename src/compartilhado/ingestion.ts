/**
 * Catálogo dos jobs de ingestão por empresa (o que hoje é `ingestao_despachar` + pg_cron). O
 * agendador do worker enfileira uma execução por empresa com a integração ligada; a API usa o
 * mesmo catálogo para disparo manual e para o status da tela Diagnóstico SSW.
 * Especificação: docs/regras/06-ingestao.md §4.
 */

export type IntegracaoDaIngestao =
  "sftp" | "ssw_api" | "ssw_bi2" | "ssw_webhook" | "ssw_web" | "xml_cte";

export interface JobDeIngestao {
  /** Nome do job no BullMQ (o handler no worker tem o mesmo nome). */
  job: string;
  descricao: string;
  /** Integração que precisa estar ligada na empresa para o job rodar. */
  integracao: IntegracaoDaIngestao;
  /**
   * Outras integrações com que o job também roda (qualquer uma ligada basta): a aplicação dos
   * relatórios vale para quem recebe pelo SFTP e para quem baixa do SSW web (ADR 0018).
   */
  alternativas?: readonly IntegracaoDaIngestao[];
  /** Cron em UTC (os horários de hoje); `null` = só sob demanda. */
  cron: string | null;
  /**
   * Uma empresa por disparo, em rodízio (`floor(minutos desde 1970) % empresas`): o BI2 é pesado
   * e o SSW limita, então só um job BI2 roda por vez em todas as empresas.
   */
  rodizio: boolean;
  /** Dados fixos do disparo agendado (o modo de hoje). */
  dados: Readonly<Record<string, string | number | boolean>>;
}

export const JOBS_DE_INGESTAO = [
  {
    job: "bi2-0017",
    descricao: "BI2 0017 — entregues (entrega e previsão de CT-e encerrado)",
    integracao: "ssw_bi2",
    cron: "12,42 * * * *",
    rodizio: true,
    dados: { modo: "cron_continuo", lookback: 2 },
  },
  {
    job: "verificar-token-ssw",
    descricao: "Token da SSW API (renovação e verificação)",
    integracao: "ssw_api",
    cron: "25 * * * *",
    rodizio: false,
    dados: {},
  },
  {
    job: "processar-webhook-ssw",
    descricao: "Ocorrências recebidas pelo webhook SSW2181",
    integracao: "ssw_webhook",
    cron: null,
    rodizio: false,
    dados: {},
  },
  {
    job: "sincronizar-ftp",
    descricao: "Relatórios SSW do SFTP (036/038/050/306/455/930)",
    integracao: "sftp",
    // Todo minuto menos :00 e :30, um horário só para todas as empresas (Q37 do dono).
    cron: "1-29,31-59 * * * *",
    rodizio: false,
    dados: {},
  },
  {
    job: "sincronizar-ftp-retroativo",
    descricao: "Revarredura dos importados do SFTP (03:10 de Brasília)",
    integracao: "sftp",
    cron: "10 6 * * *",
    rodizio: false,
    dados: { retroativo: true },
  },
  {
    job: "baixar-relatorios-ssw",
    descricao: "Relatórios do SSW web (036/038/050/306/455/930), direto na ingestão",
    integracao: "ssw_web",
    cron: "0,30 * * * *",
    rodizio: false,
    dados: {},
  },
  {
    job: "aplicar-ciclos",
    descricao: "Aplicação dos ciclos de relatórios em CT-e e ocorrências",
    integracao: "sftp",
    alternativas: ["ssw_web"],
    cron: "* * * * *",
    rodizio: false,
    dados: {},
  },
  {
    job: "sla-arquivos",
    descricao: "Unidade pelo 455 e SLA pelos arquivos",
    integracao: "sftp",
    alternativas: ["ssw_web"],
    cron: "8,38 * * * *",
    rodizio: false,
    dados: {},
  },
  {
    job: "limpar-ingestao-arquivos",
    descricao: "Limpeza das linhas superadas do 038 (03:40 de Brasília)",
    integracao: "sftp",
    alternativas: ["ssw_web"],
    cron: "40 6 * * *",
    rodizio: false,
    dados: {},
  },
  {
    job: "reprocessar-xml-orfaos",
    descricao: "Nova tentativa dos XML de CT-e órfãos",
    integracao: "xml_cte",
    cron: null,
    rodizio: false,
    dados: {},
  },
] as const satisfies readonly JobDeIngestao[];

/** A integração do job e as alternativas: qualquer uma ligada faz o job rodar na empresa. */
export function integracoesDoJob(job: JobDeIngestao): IntegracaoDaIngestao[] {
  return [job.integracao, ...(job.alternativas ?? [])];
}

export type NomeDoJobDeIngestao = (typeof JOBS_DE_INGESTAO)[number]["job"];

/** Fila do BullMQ de cada job: uma por job, para o singleton por empresa e a concorrência. */
export function filaDoJob(job: NomeDoJobDeIngestao): `ingestao.${NomeDoJobDeIngestao}` {
  return `ingestao.${job}`;
}

/**
 * Id de deduplicação: no máximo uma execução por job e empresa na fila (a que chega com outra
 * esperando ou rodando é descartada — o `ja_rodando` de hoje).
 */
export function idDeExecucao(job: NomeDoJobDeIngestao, empresaId: string): string {
  return `${job}__${empresaId}`;
}

/** Prefixo das chaves do BullMQ no Redis (o mesmo no worker e na API). */
export const PREFIXO_DAS_FILAS = "erp";

/**
 * Política padrão dos jobs (worker e disparo manual da API): 5 tentativas com espera exponencial
 * de 30 s; histórico limitado no Redis.
 */
export const OPCOES_PADRAO_DO_JOB = {
  attempts: 5,
  backoff: { type: "exponential", delay: 30_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

export type ResultadoDaExecucao =
  { tipo: "concluido"; valor: unknown } | { tipo: "falhou"; erro: string } | { tipo: "pendente" };

export interface StatusDaFila {
  agendado: boolean;
  proximaExecucao: Date | null;
  aguardando: number;
  ativos: number;
  atrasados: number;
  falhos: number;
  ultimaConclusao: Date | null;
  ultimasFalhas: { id: string; quando: Date | null; erro: string; tentativas: number }[];
}

/** Filas da ingestão vistas pela API e o token da SSW API no Redis. */
export interface FilasDeIngestao {
  enfileirar(
    job: NomeDoJobDeIngestao,
    dados: Readonly<Record<string, unknown>>,
    opcoes: { deduplicar: string | null },
  ): Promise<string>;
  aguardar(job: NomeDoJobDeIngestao, jobId: string, prazoMs: number): Promise<ResultadoDaExecucao>;
  status(job: NomeDoJobDeIngestao, empresaId: string): Promise<StatusDaFila>;
  tokenSswGeradoEm(empresaId: string): Promise<Date | null>;
  esquecerTokenSsw(empresaId: string): Promise<void>;
}

export function ehJobDeIngestao(nome: string): nome is NomeDoJobDeIngestao {
  return JOBS_DE_INGESTAO.some((j) => j.job === nome);
}

/**
 * Token de sessão da SSW API no Redis (cifrado pelo worker): `{ token: {cifrado, versaoChave},
 * geradoEm }`. A API só lê `geradoEm` (faixa de saúde) e apaga ao trocar as credenciais.
 */
export function chaveDoTokenSsw(empresaId: string): string {
  return `${PREFIXO_DAS_FILAS}:ssw-api:token:${empresaId}`;
}

/**
 * Jobs de outros domínios que a ingestão enfileira; o worker os registra com o mesmo nome e fila.
 * Projeções do Romaneio: as chaves (sigla + número) que mudaram no 036/038/306/455 ou no CT-e,
 * até `maxChaves` por job, e as linhas apagadas pelo descarte de ciclo.
 */
export const JOB_PROJECOES_ROMANEIO = {
  fila: "projecoes",
  nome: "projecoes-romaneio",
  maxChaves: 50_000,
} as const;

/** Relatório 050 de coletas que chega pelo FTP (o mesmo caso de uso da importação da tela). */
export const JOB_COLETAS_050 = { fila: "coletas", nome: "importar-coletas-050" } as const;
