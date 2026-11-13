/**
 * Onde o token da SSW API fica entre um heartbeat e outro: Redis, cifrado com a chave dos
 * segredos de integração. Some com 7 dias sem renovação (a faixa já diz "token expirado" em 4 h).
 */
import {
  type ChavesDeSegredo,
  cifrarSegredo,
  decifrarSegredo,
  type SegredoCifrado,
} from "@erp/db/secrets";
import { chaveDoTokenSsw } from "@erp/shared/ingestion";
import { z } from "@erp/shared/zod";

const RETENCAO_S = 7 * 24 * 3600;

const gravado = z.object({
  token: z.object({ cifrado: z.string(), versaoChave: z.number().int() }),
  geradoEm: z.iso.datetime(),
});

export interface TokenGuardado {
  token: string;
  geradoEm: Date;
}

export interface CofreDeToken {
  ler(empresaId: string): Promise<TokenGuardado | null>;
  gravar(empresaId: string, token: string, geradoEm: Date): Promise<void>;
}

/** O pedaço do ioredis que o cofre usa (os testes passam um falso). */
export interface RedisDoCofre {
  get(chave: string): Promise<string | null>;
  set(chave: string, valor: string, modo: "EX", segundos: number): Promise<unknown>;
}

const contexto = (empresaId: string) => `${empresaId}:ssw_api:token`;

export function criarCofreDeToken(
  redis: RedisDoCofre,
  chaves: ChavesDeSegredo | null,
): CofreDeToken {
  return {
    ler: async (empresaId) => {
      const texto = await redis.get(chaveDoTokenSsw(empresaId));
      if (texto === null || chaves === null) return null;
      const lido = gravado.safeParse(jsonOuNulo(texto));
      if (!lido.success) return null;
      const segredo: SegredoCifrado = lido.data.token;
      return {
        token: decifrarSegredo(chaves, segredo, contexto(empresaId)),
        geradoEm: new Date(lido.data.geradoEm),
      };
    },
    gravar: async (empresaId, token, geradoEm) => {
      if (chaves === null) throw new Error("Chave dos segredos de integração não configurada.");
      const valor = JSON.stringify({
        token: cifrarSegredo(chaves, token, contexto(empresaId)),
        geradoEm: geradoEm.toISOString(),
      });
      await redis.set(chaveDoTokenSsw(empresaId), valor, "EX", RETENCAO_S);
    },
  };
}

function jsonOuNulo(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return null;
  }
}

/** Quando o token guardado foi gerado, sem decifrá-lo (situação pedida pelo ERP). */
export async function geradoEmDoToken(
  redis: Pick<RedisDoCofre, "get">,
  empresaId: string,
): Promise<Date | null> {
  const texto = await redis.get(chaveDoTokenSsw(empresaId));
  if (texto === null) return null;
  const lido = gravado.safeParse(jsonOuNulo(texto));
  return lido.success ? new Date(lido.data.geradoEm) : null;
}
