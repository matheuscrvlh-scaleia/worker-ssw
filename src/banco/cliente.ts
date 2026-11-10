import { type SQL, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

export type Banco = NodePgDatabase<typeof schema>;
/** Executor dentro da transação com contexto: é o que repositórios recebem. */
export type Transacao = Parameters<Parameters<Banco["transaction"]>[0]>[0];

export interface ConfigBanco {
  url: string;
  maxConexoes: number;
  /** Teto de cada consulta; estourou, o Postgres cancela e a API pede para filtrar mais. */
  timeoutConsultaMs: number;
  nomeAplicacao: string;
}

export interface ConexaoBanco {
  banco: Banco;
  verificar: () => Promise<void>;
  encerrar: () => Promise<void>;
}

export function conectarBanco(config: ConfigBanco): ConexaoBanco {
  const pool = new Pool({
    connectionString: config.url,
    max: config.maxConexoes,
    application_name: config.nomeAplicacao,
    // Teto também fora das transações com contexto (ex.: readiness).
    statement_timeout: config.timeoutConsultaMs,
  });
  const banco = drizzle(pool, { schema });
  return {
    banco,
    verificar: async () => {
      await pool.query("select 1");
    },
    encerrar: () => pool.end(),
  };
}

/**
 * Quem está pedindo. Vira `SET LOCAL` na transação e é o que as políticas RLS leem: sem empresa,
 * nenhuma linha de dado de empresa aparece.
 */
export interface ContextoBanco {
  empresaId: string | null;
  usuarioId: string | null;
  plataforma: boolean;
  /**
   * Só a rota pública do ranking: SHA-256 do token do link. A política
   * `equipes_token_publico_select` deixa ver a equipe desse link sem empresa na sessão.
   */
  tokenPublicoHash?: string;
}

export const CONTEXTO_VAZIO: ContextoBanco = {
  empresaId: null,
  usuarioId: null,
  plataforma: false,
};

/** `set_config(..., true)` = `SET LOCAL`, mas com os valores como parâmetros (nada concatenado). */
export function sqlDoContexto(contexto: ContextoBanco): SQL {
  const token =
    contexto.tokenPublicoHash === undefined
      ? sql``
      : sql`, set_config('app.token_publico_hash', ${contexto.tokenPublicoHash}, true)`;
  return sql`select
    set_config('app.empresa_id', ${contexto.empresaId ?? ""}, true),
    set_config('app.usuario_id', ${contexto.usuarioId ?? ""}, true),
    set_config('app.plataforma', ${contexto.plataforma ? "on" : "off"}, true)${token}`;
}

/**
 * Abre uma transação, grava o contexto (`sqlDoContexto`) e roda `fn` nela. Commit ao terminar, rollback
 * em erro. O contexto some no fim da transação, então a conexão volta limpa ao pool.
 */
export async function comContexto<T>(
  banco: Banco,
  contexto: ContextoBanco,
  fn: (tx: Transacao) => Promise<T>,
): Promise<T> {
  return banco.transaction(async (tx) => {
    await tx.execute(sqlDoContexto(contexto));
    return fn(tx);
  });
}

/** Código do Postgres para consulta cancelada por `statement_timeout`. */
const CONSULTA_CANCELADA = "57014";

/** Código do Postgres para violação de chave única. */
const VIOLACAO_DE_UNICIDADE = "23505";

function temCodigo(erro: unknown, codigo: string): boolean {
  if (typeof erro !== "object" || erro === null) return false;
  if ("code" in erro && erro.code === codigo) return true;
  // O driver às vezes embrulha o erro do pg (`cause`).
  return "cause" in erro && temCodigo(erro.cause, codigo);
}

export function ehTempoEsgotado(erro: unknown): boolean {
  return temCodigo(erro, CONSULTA_CANCELADA);
}

/** Corrida entre duas gravações iguais: a checagem do caso de uso passou nas duas. */
export function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return temCodigo(erro, VIOLACAO_DE_UNICIDADE);
}
