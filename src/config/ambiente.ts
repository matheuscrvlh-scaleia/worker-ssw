import { z } from "@erp/shared/zod";

const booleano = (padrao: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(padrao)
    .transform((v) => v === "true");

const lista = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((j) => j.trim())
      .filter(Boolean),
  );

const esquema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_NIVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  /** Papel `erp_worker` (sem BYPASSRLS) no schema `erp` do Postgres do ERP. */
  DATABASE_URL: z.string().min(1),
  DB_MAX_CONEXOES: z.coerce.number().int().positive().default(5),
  // Jobs de ingestão leem mais que uma tela: teto maior que o da API do ERP.
  DB_TIMEOUT_CONSULTA_MS: z.coerce.number().int().positive().default(120_000),
  /** Redis próprio do worker-ssw (filas, travas, token do SSW, limites de taxa). */
  REDIS_URL: z.string().min(1),
  /** Porta única: rotas públicas, HTTP interno, saúde e métricas. */
  PORTA: z.coerce.number().int().positive().default(3003),
  HOST: z.string().default("0.0.0.0"),
  /** Saltos de proxy confiáveis no X-Forwarded-For (o Caddy do ERP = 1). */
  PROXIES_CONFIAVEIS: z.coerce.number().int().min(0).default(1),
  /** Consumidores do BullMQ neste processo. Desligado = só HTTP (recebe e enfileira). */
  WORKERS_LIGADOS: booleano("true"),
  /** Agendamentos repetíveis (cron). Desligados por padrão: ligar só no ambiente que ingere. */
  AGENDAMENTOS_LIGADOS: booleano("false"),
  /**
   * Jobs de ingestão que o agendador dispara (separados por vírgula, ex.: `bi2-0017,verificar-token-ssw`).
   * Vazio = nenhum: cada job é ligado de propósito, no ambiente que deve rodar.
   */
  INGESTAO_JOBS_LIGADOS: lista,
  /**
   * Tokens de serviço aceitos no HTTP interno (`atual,anterior`, para girar sem queda). Vazio =
   * HTTP interno desligado (503). Cada um com pelo menos 32 caracteres.
   */
  INTERNO_TOKENS: lista.pipe(z.array(z.string().min(32, "token interno curto demais (mín. 32)"))),
  /** `/metrics` só existe com este token (Bearer). */
  METRICAS_TOKEN: z.string().min(32).optional(),
  /** Chaves mestras dos segredos de integração (`1:<base64 32 bytes>,2:...`), as mesmas do ERP. */
  SEGREDOS_CHAVES: z.string().min(1).optional(),
  SEGREDOS_CHAVE_ATUAL: z.coerce.number().int().positive().default(1),
  /** SFTP da ingestão: só vale para integração com `parametros.usar_env` (transição da FR). */
  SFTP_HOST: z.string().optional(),
  SFTP_PORTA: z.string().optional(),
  SFTP_USUARIO: z.string().optional(),
  SFTP_SENHA: z.string().optional(),
  /** Impressão SHA-256 da chave do servidor (`SHA256:…`); sem ela o SFTP não conecta. */
  SFTP_IMPRESSAO_DIGITAL: z.string().optional(),
});

export type Ambiente = z.output<typeof esquema>;

export function carregarAmbiente(fonte: Record<string, string | undefined>): Ambiente {
  const resultado = esquema.safeParse(fonte);
  if (!resultado.success) {
    throw new Error(`Configuração inválida:\n${z.prettifyError(resultado.error)}`);
  }
  return resultado.data;
}
