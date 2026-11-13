/**
 * Contrato do HTTP interno do worker-ssw (ERP → worker-ssw), ADR 0012 do ERP SSW.
 *
 * Este arquivo é copiado, com o mesmo conteúdo, para `erp-ssw/packages/shared/src/contratos/
 * worker-ssw.ts`: só importa o zod e não depende de nada do worker-ssw. Mudou aqui, muda lá (e os
 * testes de cada lado conferem os `EXEMPLOS`).
 *
 * Autenticação: `Authorization: Bearer <token de serviço>`. Base: `WORKER_SSW_URL` (rede interna).
 */
import { z } from "zod";

export const PREFIXO_INTERNO = "/interno/v1";

/** Jobs que o ERP pode pedir. Os outros (despachante, retenção, SLA, 050) são só do worker-ssw. */
export const JOBS_PEDIVEIS = [
  "sincronizar-ftp",
  "sincronizar-ftp-retroativo",
  "baixar-relatorios-ssw",
  "aplicar-ciclos",
  "bi2-0017",
  "verificar-token-ssw",
  "processar-webhook-ssw",
  "reprocessar-xml-orfaos",
  "projecoes-romaneio",
  "projecoes-romaneio-completa",
] as const;

export type JobPedivel = (typeof JOBS_PEDIVEIS)[number];

const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD).");
const chaveDoCte = z.object({ sigla: z.string().min(1), numero: z.string().min(1) });
/** Teto de chaves por pedido de projeções (o mesmo do job). */
export const MAX_CHAVES_DAS_PROJECOES = 50_000;

/** `dados` de cada job, sem a empresa (ela vai no caminho). Campo desconhecido = 400. */
export const DADOS_DOS_JOBS = {
  "sincronizar-ftp": z.strictObject({ manual: z.boolean().optional() }),
  "sincronizar-ftp-retroativo": z.strictObject({}),
  /** `dia` (passado): repõe um buraco com os relatórios daquele dia (sem o 038). */
  "baixar-relatorios-ssw": z.strictObject({ dia: dataIso.optional() }),
  "aplicar-ciclos": z.strictObject({}),
  "bi2-0017": z.strictObject({
    modo: z.enum(["cron_continuo", "manual"]).optional(),
    data: dataIso.optional(),
    lookback: z.number().int().min(0).max(31).optional(),
  }),
  /** `manual: true` sempre renova o token (botão "Testar conexão" e troca de credencial). */
  "verificar-token-ssw": z.strictObject({ manual: z.boolean().optional() }),
  "processar-webhook-ssw": z.strictObject({
    eventoId: z.uuid(),
    protocolo: z.string().min(1).max(16),
  }),
  "reprocessar-xml-orfaos": z.strictObject({
    limite: z.number().int().min(1).max(1000).optional(),
  }),
  "projecoes-romaneio": z.strictObject({
    chaves: z.array(chaveDoCte).min(1).max(MAX_CHAVES_DAS_PROJECOES),
  }),
  "projecoes-romaneio-completa": z.strictObject({}),
} as const satisfies Record<JobPedivel, z.ZodType>;

/** POST `/interno/v1/empresas/:empresaId/execucoes` */
export const parametrosDaEmpresa = z.object({ empresaId: z.uuid() });

export const pedidoDeExecucao = z.strictObject({
  job: z.enum(JOBS_PEDIVEIS),
  dados: z.record(z.string(), z.unknown()).optional(),
  /**
   * `true` = no máximo uma execução deste job por empresa na fila (por evento, no webhook): se já
   * houver uma esperando ou rodando, a resposta é 409 e nada entra.
   */
  deduplicar: z.boolean().optional(),
});
export type PedidoDeExecucao = z.infer<typeof pedidoDeExecucao>;

/** 202 */
export const execucaoCriada = z.object({ execucaoId: z.string().min(1) });

/** GET `/interno/v1/execucoes/:job/:execucaoId?aguardarMs=0..60000` */
export const parametrosDaExecucao = z.object({
  job: z.enum(JOBS_PEDIVEIS),
  execucaoId: z.string().min(1).max(200),
});
export const consultaDaExecucao = z.object({
  aguardarMs: z.coerce.number().int().min(0).max(60_000).default(0),
});

export const ESTADOS_DA_EXECUCAO = ["na_fila", "rodando", "concluida", "falhou"] as const;
export type EstadoDaExecucao = (typeof ESTADOS_DA_EXECUCAO)[number];

export const situacaoDaExecucao = z.object({
  estado: z.enum(ESTADOS_DA_EXECUCAO),
  /** O que o job devolveu (só em `concluida`). */
  resultado: z.unknown().optional(),
  /** Mensagem para o operador (só em `falhou`). */
  erro: z.string().optional(),
});
export type SituacaoDaExecucao = z.infer<typeof situacaoDaExecucao>;

/**
 * Jobs que aparecem na situação (Diagnóstico SSW): os pedíveis e os que só o agendador dispara.
 */
export const JOBS_ACOMPANHADOS = [
  ...JOBS_PEDIVEIS,
  "sla-arquivos",
  "limpar-ingestao-arquivos",
] as const;
export type JobAcompanhado = (typeof JOBS_ACOMPANHADOS)[number];

/** Quantas falhas recentes da empresa a situação traz por job. */
export const MAX_ULTIMAS_FALHAS = 3;

/** GET `/interno/v1/empresas/:empresaId/situacao` */
export const situacaoDaEmpresa = z.object({
  jobs: z.array(
    z.object({
      job: z.enum(JOBS_ACOMPANHADOS),
      /** Da execução mais recente da empresa; `sem_execucao` se não há nenhuma no histórico. */
      estado: z.enum([...ESTADOS_DA_EXECUCAO, "sem_execucao"]),
      ultimaExecucao: z
        .object({
          execucaoId: z.string(),
          estado: z.enum(["concluida", "falhou"]),
          terminadaEm: z.iso.datetime(),
          erro: z.string().optional(),
        })
        .optional(),
      proximaExecucao: z.iso.datetime().optional(),
      /** Há agendamento (cron) deste job, global ou da empresa. */
      agendado: z.boolean(),
      /** Contagens da fila do job (todas as empresas), como o Diagnóstico SSW mostrava. */
      naFila: z.number().int().min(0),
      rodando: z.number().int().min(0),
      /** Esperando o horário (nova tentativa com espera ou execução adiada). */
      atrasados: z.number().int().min(0),
      falhos: z.number().int().min(0),
      /** Falhas recentes desta empresa, da mais nova para a mais antiga; `erro` é para o operador. */
      ultimasFalhas: z
        .array(
          z.object({
            execucaoId: z.string(),
            quando: z.iso.datetime(),
            erro: z.string(),
            tentativas: z.number().int().min(0),
          }),
        )
        .max(MAX_ULTIMAS_FALHAS),
    }),
  ),
  /** Fila de aplicação da ingestão por arquivo (Importação SSW: "Na fila" e "aplicando"). */
  aplicacao: z.object({
    /** Chaves de CT-e esperando a aplicação. */
    pendentes: z.number().int().min(0),
    /** A aplicação (automática ou manual) está rodando agora. */
    rodando: z.boolean(),
  }),
  /** Quando o token da SSW API em uso foi gerado (faixa de saúde do ERP). */
  tokenSswGeradoEm: z.iso.datetime().optional(),
});
export type SituacaoDaEmpresa = z.infer<typeof situacaoDaEmpresa>;

// --- Operações manuais da tela Admin › Importação SSW -------------------------------------------
// Mesmas respostas que a tela já usa (erp-ssw `contratos/ingestao.ts`). O ERP valida o pedido da
// tela, audita quem pediu e repassa; quem grava e decide é o worker-ssw.

export const ok = z.object({ ok: z.literal(true) });

/** POST `.../ciclos/:chave/retomar` e `.../ciclos/:chave/descartar` */
export const parametrosDoCiclo = z.object({
  empresaId: z.uuid(),
  chave: z.string().min(1).max(100),
});

/** 200 de `retomar` */
export const cicloRetomado = z.object({
  cicloChave: z.string(),
  status: z.enum(["nada_a_fazer", "aguardando", "aplicado", "erro"]),
  motivo: z.string().nullable(),
});

export const pedidoDeDescarte = z.strictObject({
  motivo: z.string().trim().min(3, "Informe o motivo do descarte.").max(500).optional(),
});

/** 200 de `descartar` (as projeções do Romaneio dos CT-e afetados entram na fila) */
export const cicloDescartado = z.object({
  cicloChave: z.string(),
  totalRemovido: z.number().int(),
});

/** Tamanho máximo do arquivo enviado à mão (relatório ou XML/zip), já decodificado. */
export const LIMITE_DO_ARQUIVO_MANUAL = 64 * 1024 * 1024;
/** O mesmo teto em base64 (4 caracteres a cada 3 bytes), com folga para o prefixo `data:`. */
export const LIMITE_DO_ARQUIVO_EM_BASE64 = Math.ceil(LIMITE_DO_ARQUIVO_MANUAL / 3) * 4 + 256;

const conteudoBase64 = z
  .string()
  .min(1, "Arquivo vazio.")
  .max(LIMITE_DO_ARQUIVO_EM_BASE64, "Arquivo maior que 64 MB.");

export const RELATORIOS_MANUAIS = ["036", "038", "306", "455csv", "930"] as const;

/** POST `.../relatorios`: o texto do CSV em UTF-8, codificado em base64. */
export const pedidoDeRelatorio = z.strictObject({
  relatorio: z.enum(RELATORIOS_MANUAIS),
  nomeArquivo: z.string().max(300).nullable(),
  conteudoBase64,
  /** Grava mesmo com cabeçalho diferente do esperado (confirmação da tela). */
  aceitarDivergencia: z.boolean().default(false),
});
export type PedidoDeRelatorio = z.input<typeof pedidoDeRelatorio>;
export type RelatorioValidado = z.output<typeof pedidoDeRelatorio>;

export const relatorioImportado = z.object({
  loteId: z.uuid(),
  gravados: z.number().int(),
  erros: z.number().int(),
});

/** POST `.../aplicacoes`: `simular` não grava nada e devolve o mesmo resumo. */
export const pedidoDeAplicacao = z.strictObject({
  simular: z.boolean(),
  limite: z.number().int().min(1).max(20_000).default(4000),
  offset: z.number().int().min(0).default(0),
});
export type PedidoDeAplicacao = z.input<typeof pedidoDeAplicacao>;
export type AplicacaoValidada = z.output<typeof pedidoDeAplicacao>;

export const resultadoDaAplicacao = z.object({
  dryRun: z.boolean(),
  offset: z.number().int(),
  processados: z.number().int(),
  candidatos: z.number().int(),
  pendentes: z.number().int(),
  totais: z.object({
    inserir: z.number().int(),
    atualizar: z.number().int(),
    ocorrencias: z.number().int(),
    ignorados: z.number().int(),
  }),
  inserir: z.array(
    z.object({
      chave: z.string(),
      dataEmissao: z.string().nullable(),
      previsao: z.string().nullable(),
    }),
  ),
  atualizar: z.array(z.object({ chave: z.string(), campos: z.array(z.string()) })),
  ocorrencias: z.array(
    z.object({ chave: z.string(), codigo: z.number().int(), dataHora: z.string() }),
  ),
  ignorados: z.array(z.object({ chave: z.string(), motivo: z.string() })),
  temMais: z.boolean(),
  romaneio036: z.number().int().nullable(),
});
export type ResultadoDaAplicacao = z.infer<typeof resultadoDaAplicacao>;

/** GET `.../ftp`. O histórico das sincronizações o ERP lê direto do banco. */
export const situacaoDoFtp = z.object({
  ativo: z.boolean(),
  agenda: z.string(),
  travaAtiva: z.boolean(),
  progresso: z
    .object({
      fase: z.enum(["conectando", "processando", "relatorios", "retroativo", "concluido"]),
      totalArquivos: z.number().int(),
      arquivoAtualIndice: z.number().int(),
      arquivoAtualNome: z.string().nullable(),
      mensagem: z.string().nullable(),
      iniciadoEm: z.iso.datetime().nullable(),
      heartbeatEm: z.iso.datetime().nullable(),
      finalizadoEm: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type SituacaoDoFtp = z.infer<typeof situacaoDoFtp>;

/** PUT `.../ftp/ativo` (200 `ok`); POST `.../ftp/liberar-trava` não tem corpo (200 `ok`). */
export const pedidoDeFtpAtivo = z.strictObject({ ativo: z.boolean() });

/** POST `.../xml`: um `.xml` ou `.zip` em base64 (com ou sem o prefixo `data:`). */
export const pedidoDeXml = z.strictObject({
  nomeArquivo: z.string().min(1).max(300),
  conteudoBase64,
});
export type PedidoDeXml = z.infer<typeof pedidoDeXml>;

const STATUS_DO_XML = ["sucesso", "erro", "parcial", "duplicado"] as const;
export const resultadoDoXml = z.object({
  arquivo: z.string(),
  status: z.enum(STATUS_DO_XML),
  ctesProcessados: z.number().int(),
  cancelamentos: z.number().int(),
  orfaos: z.number().int(),
  pulados: z.number().int(),
  erros: z.array(z.object({ nome: z.string(), erro: z.string() })),
});
export type ResultadoDoXml = z.infer<typeof resultadoDoXml>;

/** Toda resposta de erro do HTTP interno: mensagem para o operador, em português. */
export const erroInterno = z.object({
  erro: z.object({ codigo: z.string(), mensagem: z.string() }),
});

/** Exemplos do contrato: os testes do worker-ssw e do ERP validam cada um. */
export const EXEMPLOS = {
  pedido: {
    job: "bi2-0017",
    dados: { modo: "manual", data: "2026-11-09" },
    deduplicar: true,
  } satisfies PedidoDeExecucao,
  criada: { execucaoId: "9f0c6a52-3a4b-4d8e-9c1f-2b7d5e6a8c90" },
  concluida: {
    estado: "concluida",
    resultado: { ok: true, renovado: false },
  } satisfies SituacaoDaExecucao,
  falhou: {
    estado: "falhou",
    erro: "Falha ao executar o job. Tente de novo; se persistir, avise o suporte.",
  } satisfies SituacaoDaExecucao,
  situacao: {
    jobs: [
      {
        job: "sincronizar-ftp",
        estado: "concluida",
        ultimaExecucao: {
          execucaoId: "sincronizar-ftp-1",
          estado: "concluida",
          terminadaEm: "2026-11-10T12:01:30.000Z",
        },
        proximaExecucao: "2026-11-10T12:02:00.000Z",
        agendado: true,
        naFila: 1,
        rodando: 1,
        atrasados: 0,
        falhos: 2,
        ultimasFalhas: [
          {
            execucaoId: "sincronizar-ftp-0",
            quando: "2026-11-10T11:31:10.000Z",
            erro: "Falha ao executar o job. Tente de novo; se persistir, avise o suporte.",
            tentativas: 3,
          },
        ],
      },
      {
        job: "bi2-0017",
        estado: "sem_execucao",
        agendado: false,
        naFila: 0,
        rodando: 0,
        atrasados: 0,
        falhos: 0,
        ultimasFalhas: [],
      },
    ],
    aplicacao: { pendentes: 1520, rodando: false },
    tokenSswGeradoEm: "2026-11-10T11:25:00.000Z",
  } satisfies SituacaoDaEmpresa,
  erro: {
    erro: { codigo: "CONFLITO", mensagem: "Este job já está na fila desta empresa." },
  },
  cicloRetomado: {
    cicloChave: "2026-11-10T12:00",
    status: "aplicado",
    motivo: null,
  } satisfies z.infer<typeof cicloRetomado>,
  descarte: { motivo: "Arquivo do 455 veio truncado" } satisfies z.input<typeof pedidoDeDescarte>,
  cicloDescartado: { cicloChave: "2026-11-10T12:00", totalRemovido: 1520 } satisfies z.infer<
    typeof cicloDescartado
  >,
  relatorio: {
    relatorio: "930",
    nomeArquivo: "930_20261110.csv",
    conteudoBase64: "Q1RSQztPQ09SUkVOQ0lBCjEyMzs1Cg==",
    aceitarDivergencia: false,
  } satisfies PedidoDeRelatorio,
  relatorioImportado: {
    loteId: "3c1e2a4b-5d6f-4a8b-9c0d-1e2f3a4b5c6d",
    gravados: 1,
    erros: 0,
  } satisfies z.infer<typeof relatorioImportado>,
  aplicacao: { simular: true, limite: 4000, offset: 0 } satisfies PedidoDeAplicacao,
  resultadoDaAplicacao: {
    dryRun: true,
    offset: 0,
    processados: 1,
    candidatos: 1,
    pendentes: 0,
    totais: { inserir: 0, atualizar: 1, ocorrencias: 1, ignorados: 0 },
    inserir: [],
    atualizar: [{ chave: "SAO-123456", campos: ["previsao_entrega"] }],
    ocorrencias: [{ chave: "SAO-123456", codigo: 1, dataHora: "2026-11-10T10:30:00.000Z" }],
    ignorados: [],
    temMais: false,
    romaneio036: 0,
  } satisfies ResultadoDaAplicacao,
  ftp: {
    ativo: true,
    agenda: "A cada minuto, exceto :00 e :30 (1-29,31-59 * * * * UTC)",
    travaAtiva: true,
    progresso: {
      fase: "relatorios",
      totalArquivos: 4,
      arquivoAtualIndice: 2,
      arquivoAtualNome: "455_20261110.csv",
      mensagem: null,
      iniciadoEm: "2026-11-10T12:01:00.000Z",
      heartbeatEm: "2026-11-10T12:01:20.000Z",
      finalizadoEm: null,
    },
  } satisfies SituacaoDoFtp,
  ftpAtivo: { ativo: false } satisfies z.infer<typeof pedidoDeFtpAtivo>,
  ok: { ok: true } satisfies z.infer<typeof ok>,
  xml: {
    nomeArquivo: "ctes.zip",
    conteudoBase64: "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==",
  } satisfies PedidoDeXml,
  resultadoDoXml: {
    arquivo: "ctes.zip",
    status: "parcial",
    ctesProcessados: 3,
    cancelamentos: 0,
    orfaos: 1,
    pulados: 0,
    erros: [{ nome: "ctes/4.xml", erro: "XML sem infCte" }],
  } satisfies ResultadoDoXml,
} as const;
