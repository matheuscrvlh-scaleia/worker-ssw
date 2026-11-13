/**
 * Portas dos casos de uso da ingestão: o que eles pedem ao banco, ao Redis, ao SFTP e à fila de
 * jobs. As implementações de verdade estão em `../infra`; os testes passam falsos.
 */
import {
  type CatalogoDeCodigos,
  type CodigoNovo,
  type ConfiguracaoDoNucleo,
  type FilialCadastrada,
  type OcorrenciaDoCte,
  type RegraDePrazo,
  type Responsavel,
  type TrocaDePrevisao,
} from "@erp/domain/core";

import { type CamposDoCte, type ChaveCte, type CteDaIngestao } from "../regras";

/** Relatório gravado em `ingestao_linhas` (o 050 vai para coletas e só é registrado no arquivo). */
export type RelatorioGuardado = "036" | "038" | "306" | "455csv" | "930";

/** Relatórios que formam a fila de aplicação no CT-e. */
export const RELATORIOS_DA_FILA = ["930", "038", "455csv"] as const;

// --- Banco --------------------------------------------------------------------------------------

export interface EmpresaDaIngestao {
  id: string;
  nome: string;
  dominioSsw: string | null;
  cnpj: string | null;
}

export interface ArquivoRegistrado {
  id: string;
  nomeArquivo: string;
  cicloChave: string | null;
  relatorio: string | null;
  unidade: string | null;
  status: string;
  sha256: string | null;
  linhas: number;
  loteId: string | null;
  mensagem: string | null;
  vistoEm: Date;
  importadoEm: Date | null;
}

export interface RegistroDeArquivo {
  nomeArquivo: string;
  cicloChave: string | null;
  relatorio: string | null;
  unidade: string | null;
  tamanho: number;
  mtime: number;
  sha256: string | null;
  status: string;
  linhas: number;
  mensagem: string | null;
  loteId: string | null;
}

export interface CicloRegistrado {
  cicloChave: string;
  status: string;
  motivo: string | null;
  faltantes: string[];
  totais: Record<string, unknown>;
  arquivosImportados: number;
  linhasImportadas: number;
  primeiroArquivoEm: Date;
  ultimoArquivoEm: Date;
  fechadoEm: Date | null;
  aplicadoEm: Date | null;
}

export type MudancaDoCiclo = Partial<
  Pick<CicloRegistrado, "status" | "motivo" | "faltantes" | "totais" | "fechadoEm" | "aplicadoEm">
> & { somarArquivos?: number; somarLinhas?: number; tocarUltimoArquivo?: boolean };

/** Linha a gravar em `ingestao_linhas`. */
export interface LinhaNova {
  numeroLinha: number;
  hash: string;
  sigla: string | null;
  numero: string | null;
  dataReferencia: Date | null;
  dados: unknown;
}

export interface ErroNovo {
  relatorio: string;
  etapa: "analise" | "gravacao";
  arquivoOrigem: string | null;
  numeroLinha: number | null;
  linhaBruta: string | null;
  motivo: string;
}

/** Linha apagada pelo descarte de ciclo: o que as projeções do Romaneio precisam saber dela. */
export interface LinhaApagada {
  relatorio: string;
  sigla: string | null;
  numero: string | null;
  dados: unknown;
}

/** Linha guardada com a chave do CT-e. */
export interface LinhaDaChave {
  id: number;
  loteId: string;
  importadoEm: Date;
  sigla: string;
  numero: string;
  dados: unknown;
}

/** Cadastros que o núcleo lê, carregados uma vez por bloco. */
export interface CadastrosDoNucleo {
  catalogo: CatalogoDeCodigos;
  filiais: readonly FilialCadastrada[];
  regrasDePrazo: readonly RegraDePrazo[];
  config: ConfiguracaoDoNucleo;
  /** CNPJs (dígitos) da própria empresa: `empresas.cnpj` + `cnpjs_emitentes` da integração XML. */
  cnpjsProprios: readonly string[];
  /** Domínio da empresa no SSW (a ocorrência do webhook decide a filial por ele). */
  dominioSsw: string | null;
}

export interface OcorrenciaNova {
  cteId: string;
  codigo: number;
  descricao: string | null;
  complemento: string | null;
  dataHora: Date;
  filial: string | null;
  origem: string;
  responsavel: Responsavel;
  penaliza: boolean;
  quarentena: boolean;
}

export interface EventoDeAuditoriaDaIngestao {
  acao: string;
  entidade: string;
  entidadeId: string | null;
  resumo: string;
  depois: Record<string, unknown>;
}

export interface CteCandidatoXml {
  id: string;
  cnpjDaFilial: string | null;
}

export interface OrfaoXml {
  id: string;
  sha256Xml: string;
  nomeXml: string;
  tipo: "cte" | "can";
  chaveCte: string | null;
  xmlConteudo: string;
  tentativas: number;
}

export interface ArquivoXmlRegistrado {
  id: string;
  nomeArquivo: string;
  sha256: string;
  tipo: "zip" | "xml";
  status: "sucesso" | "erro" | "parcial" | "duplicado";
  erroMensagem: string | null;
  ctesProcessados: number;
  cancelamentos: number;
  xmlsPulados: number;
  criadoEm: Date;
}

export interface SincronizacaoFtp {
  executadoEm: Date;
  finalizadoEm: Date | null;
  status: "ok" | "parcial" | "erro" | "pausado";
  disparadoPor: "agendamento" | "manual";
  arquivosProcessados: number;
  arquivosMovidos: number;
  pastasLimpas: number;
  arquivosComErro: number;
  duracaoMs: number;
  mensagem: string | null;
  erros: string[];
}

/**
 * Tudo o que a ingestão lê e grava no banco, preso a uma transação no contexto da empresa (RLS).
 * Toda gravação leva a empresa do contexto.
 */
/**
 * Gravação do CT-e pelo núcleo — a mesma para todas as fontes da ingestão (arquivos do SSW, XML,
 * BI2 e webhook). Ver `regravarCte`/`criarCte`.
 */
export interface RepositorioCteNucleo {
  cadastrosDoNucleo(): Promise<CadastrosDoNucleo>;
  ocorrenciasDosCtes(ids: readonly string[]): Promise<Map<string, OcorrenciaDoCte[]>>;
  /** INSERT ... ON CONFLICT (empresa, sigla, número) DO NOTHING; devolve os que entraram. */
  inserirCtes(ctes: readonly CteDaIngestao[]): Promise<CteDaIngestao[]>;
  /** Grava só as colunas dadas (o caso de uso já tirou as iguais). */
  atualizarCte(id: string, campos: CamposDoCte): Promise<void>;
  registrarTrocaDePrevisao(cteId: string, troca: TrocaDePrevisao): Promise<void>;
}

export interface RepositorioIngestao extends RepositorioCteNucleo {
  empresa(): Promise<EmpresaDaIngestao>;
  configuracoes(chaves: readonly string[]): Promise<Map<string, string>>;
  gravarConfiguracao(chave: string, valor: string): Promise<void>;

  // Arquivos e ciclos
  arquivoPorNome(nome: string): Promise<ArquivoRegistrado | null>;
  registrarArquivo(r: RegistroDeArquivo): Promise<void>;
  nomesDeArquivosRegistrados(): Promise<Set<string>>;
  garantirCiclo(cicloChave: string): Promise<void>;
  ciclo(cicloChave: string): Promise<CicloRegistrado | null>;
  mudarCiclo(cicloChave: string, mudanca: MudancaDoCiclo): Promise<void>;
  ciclosAbertos(limite: number): Promise<CicloRegistrado[]>;
  /** Ciclos abertos cujo último arquivo chegou até `ate`: cobertos pela mesma fila. */
  fecharCiclosCobertos(ate: Date, agora: Date): Promise<number>;
  arquivosDoCiclo(cicloChave: string): Promise<ArquivoRegistrado[]>;
  marcarArquivosDescartados(cicloChave: string): Promise<void>;
  relatoriosEsperados(): Promise<
    {
      relatorio: string;
      porUnidade: boolean;
      unidadesEsperadas: string[];
      obrigatorioNoCiclo: boolean;
      ativo: boolean;
    }[]
  >;

  // Linhas e erros
  /** Por relatório: 455csv ignora a repetida; os demais a passam para o lote novo (pendente). */
  gravarLinhas(
    relatorio: RelatorioGuardado,
    loteId: string,
    arquivoId: string | null,
    linhas: readonly LinhaNova[],
  ): Promise<number>;
  gravarErros(loteId: string, erros: readonly ErroNovo[]): Promise<void>;
  linhasDasChaves(
    relatorio: RelatorioGuardado,
    chaves: readonly ChaveCte[],
  ): Promise<LinhaDaChave[]>;
  /** Chaves com linha pendente (`aplicado_em` nulo) nos relatórios dados. */
  chavesPendentes(relatorios: readonly RelatorioGuardado[], limite: number): Promise<ChaveCte[]>;
  todasAsChaves(relatorios: readonly RelatorioGuardado[]): Promise<ChaveCte[]>;
  marcarAplicadas(
    relatorios: readonly RelatorioGuardado[],
    chaves: readonly ChaveCte[],
    agora: Date,
  ): Promise<void>;
  linhasSemChave(relatorios: readonly RelatorioGuardado[]): Promise<number>;
  /** Chaves com linha do relatório importada desde `desde`. */
  chavesDesde(relatorio: RelatorioGuardado, desde: Date): Promise<ChaveCte[]>;
  /** Apaga as linhas e erros dos lotes; devolve o total por tabela e as linhas apagadas. */
  apagarLotes(
    loteIds: readonly string[],
  ): Promise<{ linhas: number; erros: number; apagadas: LinhaApagada[] }>;

  // CT-e e ocorrências (a gravação do núcleo está em `RepositorioCteNucleo`)
  ctesDasChaves(chaves: readonly ChaveCte[]): Promise<CteDaIngestao[]>;
  /** CT-e que já usa a chave de 44 dígitos (para não repetir chave). */
  cteDaChave(chave: string): Promise<string | null>;
  inserirCodigos(codigos: readonly CodigoNovo[]): Promise<void>;
  /** Insere sem repetir (CT-e, código, data/hora); devolve o CT-e de cada uma que entrou. */
  inserirOcorrencias(ocorrencias: readonly OcorrenciaNova[]): Promise<string[]>;
  apagarOcorrencia(cteId: string, codigo: number, dataHora: Date): Promise<number>;
  auditar(evento: EventoDeAuditoriaDaIngestao): Promise<void>;

  // Log da aplicação
  iniciarAplicacao(simulacao: boolean, usuarioId: string | null): Promise<string>;
  finalizarAplicacao(
    id: string,
    status: "concluido" | "erro",
    totais: { inserir: number; atualizar: number; ocorrencias: number; ignorados: number },
    detalhe: Record<string, unknown> | null,
    erro: string | null,
  ): Promise<void>;

  // XML de CT-e
  arquivoXmlPorSha(sha256: string): Promise<ArquivoXmlRegistrado | null>;
  registrarArquivoXml(a: Omit<ArquivoXmlRegistrado, "id" | "criadoEm">): Promise<string>;
  itemXmlJaAplicado(sha256Xml: string): Promise<boolean>;
  registrarItemXml(item: {
    arquivoId: string | null;
    sha256Xml: string;
    nomeXml: string;
    tipo: "cte" | "can" | "unknown";
    status: "sucesso" | "erro" | "orfao";
    numeroCte: string | null;
    chaveCte: string | null;
    erroMensagem: string | null;
  }): Promise<void>;
  promoverItemXml(sha256Xml: string): Promise<void>;
  ctePorChaveCte(chave: string): Promise<CteDaIngestao | null>;
  ctesPorNumeroCte(numeroCte: number): Promise<CteCandidatoXml[]>;
  ctesPorChaveNfe(chaveNfe: string): Promise<string[]>;
  ctePorId(id: string): Promise<CteDaIngestao | null>;
  guardarOrfao(o: Omit<OrfaoXml, "id" | "tentativas">, expiraEm: Date): Promise<void>;
  expirarOrfaos(agora: Date): Promise<number>;
  orfaosPendentes(limite: number): Promise<OrfaoXml[]>;
  marcarOrfao(id: string, casado: boolean, erro: string | null, agora: Date): Promise<void>;

  // FTP
  registrarSincronizacao(s: SincronizacaoFtp): Promise<void>;
}

/** Roda `fn` numa transação no contexto da empresa (cada chamada é uma transação). */
export type Transacional = <T>(fn: (repo: RepositorioIngestao) => Promise<T>) => Promise<T>;

/** Limpeza de retenção: roda no contexto da Plataforma, em todas as empresas. */
export interface RepositorioDeRetencao {
  apagarLinhasAplicadasAntesDe(limite: Date): Promise<number>;
  apagarErrosAntesDe(limite: Date): Promise<number>;
  apagarArquivosCiclosEAplicacoesAntesDe(limite: Date): Promise<number>;
  apagarXmlAntesDe(limite: Date): Promise<number>;
  apagarOrfaosResolvidosAntesDe(limite: Date): Promise<number>;
  apagarSincronizacoesAntesDe(limite: Date): Promise<number>;
  /** 038 com mais de `limite` e outra linha mais nova do mesmo CT-e; em blocos. */
  apagar038Superadas(limite: Date, bloco: number): Promise<number>;
}

// --- Redis ---------------------------------------------------------------------------------------

/** Fila de aplicação da empresa (conjunto ordenado no Redis), por chave `SIGLA|NUMERO`. */
export interface FilaDeAplicacao {
  /** Refaz a fila inteira (preparação completa). */
  substituir(empresaId: string, chaves: readonly string[]): Promise<void>;
  /** Acrescenta no fim; chave que já está na fila não muda de posição. */
  acrescentar(empresaId: string, chaves: readonly string[]): Promise<number>;
  pendentes(empresaId: string, offset: number, limite: number): Promise<string[]>;
  contar(empresaId: string): Promise<number>;
  remover(empresaId: string, chaves: readonly string[]): Promise<void>;
  controle(
    empresaId: string,
  ): Promise<{ ultimaPreparacaoEm: Date | null; ultimaCompletaEm: Date | null }>;
  registrarPreparacao(empresaId: string, completa: boolean, agora: Date): Promise<void>;
}

/** Trava com dono e validade (SET NX PX; libera só quem tem o token). */
export interface Travas {
  adquirir(chave: string, validadeMs: number): Promise<string | null>;
  liberar(chave: string, token: string): Promise<void>;
  ativa(chave: string): Promise<boolean>;
  /** Botão "liberar trava" da tela. */
  forcarLiberacao(chave: string): Promise<void>;
}

export type FaseDoFtp = "conectando" | "processando" | "relatorios" | "retroativo" | "concluido";

export interface ProgressoDoFtp {
  fase: FaseDoFtp;
  totalArquivos: number;
  arquivoAtualIndice: number;
  arquivoAtualNome: string | null;
  mensagem: string | null;
  iniciadoEm: Date | null;
  heartbeatEm: Date | null;
  finalizadoEm: Date | null;
}

export interface Progressos {
  gravar(empresaId: string, p: Partial<ProgressoDoFtp>, agora: Date): Promise<void>;
  ler(empresaId: string): Promise<ProgressoDoFtp | null>;
  limpar(empresaId: string): Promise<void>;
}

// --- SFTP ---------------------------------------------------------------------------------------

export interface ConfiguracaoSftp {
  host: string;
  porta: number;
  usuario: string;
  senha: string;
  /**
   * Impressão SHA-256 da chave do servidor (`SHA256:…`, como o `ssh-keygen -lf` mostra). Sem ela
   * a conexão é recusada: não se fala com servidor que não se conferiu.
   */
  impressaoDigital: string | null;
  relatoriosPath: string;
  importadosPath: string;
}

export interface EntradaSftp {
  nome: string;
  tamanho: number;
  /** epoch ms */
  mtime: number;
  tipo: "arquivo" | "pasta" | "outro";
}

export interface ConexaoSftp {
  existe(caminho: string): Promise<boolean>;
  listar(pasta: string): Promise<EntradaSftp[]>;
  baixar(caminho: string): Promise<Uint8Array>;
  enviar(bytes: Uint8Array, caminho: string): Promise<void>;
  renomear(de: string, para: string): Promise<void>;
  apagar(caminho: string): Promise<void>;
  criarPasta(caminho: string): Promise<void>;
  apagarPasta(caminho: string): Promise<void>;
  encerrar(): Promise<void>;
}

export interface ClienteSftp {
  conectar(c: ConfiguracaoSftp): Promise<ConexaoSftp>;
}

/** Credenciais da integração `sftp` da empresa (cofre; `usar_env` só na transição da FR). */
export interface CredenciaisDaEmpresa {
  sftp(empresaId: string): Promise<ConfiguracaoSftp | null>;
}

// --- Jobs ---------------------------------------------------------------------------------------

export interface OpcoesDeEnfileiramento {
  /** Singleton: enquanto houver um job com este id esperando ou rodando, outro não entra. */
  deduplicacao?: string;
}

export interface Enfileirador {
  enfileirar(
    fila: string,
    nome: string,
    dados: Record<string, unknown>,
    opcoes?: OpcoesDeEnfileiramento,
  ): Promise<void>;
}

export interface Relogio {
  agora(): Date;
  esperar(ms: number): Promise<void>;
}
