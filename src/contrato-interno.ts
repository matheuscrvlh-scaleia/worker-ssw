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

/** GET `/interno/v1/empresas/:empresaId/situacao` */
export const situacaoDaEmpresa = z.object({
  jobs: z.array(
    z.object({
      job: z.enum(JOBS_PEDIVEIS),
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
    }),
  ),
  /** Quando o token da SSW API em uso foi gerado (faixa de saúde do ERP). */
  tokenSswGeradoEm: z.iso.datetime().optional(),
});
export type SituacaoDaEmpresa = z.infer<typeof situacaoDaEmpresa>;

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
      },
      { job: "bi2-0017", estado: "sem_execucao" },
    ],
    tokenSswGeradoEm: "2026-11-10T11:25:00.000Z",
  } satisfies SituacaoDaEmpresa,
  erro: {
    erro: { codigo: "CONFLITO", mensagem: "Este job já está na fila desta empresa." },
  },
} as const;
