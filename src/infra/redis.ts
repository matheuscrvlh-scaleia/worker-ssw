/**
 * Estado da ingestão no Redis (modelo.md: a fila de aplicação vira Redis): fila de aplicação por
 * empresa (conjunto ordenado), travas com dono e validade.
 */
import { randomUUID } from "node:crypto";

import { type Redis } from "ioredis";

import { type FilaDeAplicacao, type Travas } from "../aplicacao/casos-de-uso/portas";

const PREFIXO = "erp:ingestao";
const LOTE = 1000;

export function criarFilaDeAplicacao(redis: Redis): FilaDeAplicacao {
  const chaveDaFila = (e: string) => `${PREFIXO}:fila:${e}`;
  const chaveDoControle = (e: string) => `${PREFIXO}:fila-controle:${e}`;
  // Pontuação crescente (ms + posição): a ordem de chegada vira a ordem da fila.
  const pontuados = (chaves: readonly string[]) => {
    const base = Date.now() * 1000;
    return chaves.flatMap((c, i) => [base + i, c]);
  };
  const emLotes = async (chaves: readonly string[], fn: (lote: string[]) => Promise<unknown>) => {
    for (let i = 0; i < chaves.length; i += LOTE) await fn(chaves.slice(i, i + LOTE));
  };
  return {
    async substituir(e, chaves) {
      const temporaria = `${chaveDaFila(e)}:nova`;
      await redis.del(temporaria);
      await emLotes(chaves, (lote) => redis.zadd(temporaria, ...pontuados(lote)));
      if (chaves.length === 0) await redis.del(chaveDaFila(e));
      else await redis.rename(temporaria, chaveDaFila(e));
    },
    async acrescentar(e, chaves) {
      let novas = 0;
      await emLotes(chaves, async (lote) => {
        novas += await redis.zadd(chaveDaFila(e), "NX", ...pontuados(lote));
      });
      return novas;
    },
    pendentes: (e, offset, limite) => redis.zrange(chaveDaFila(e), offset, offset + limite - 1),
    contar: (e) => redis.zcard(chaveDaFila(e)),
    async remover(e, chaves) {
      await emLotes(chaves, (lote) => redis.zrem(chaveDaFila(e), ...lote));
    },
    async controle(e) {
      const c = await redis.hgetall(chaveDoControle(e));
      const data = (v: string | undefined) => (v ? new Date(v) : null);
      return { ultimaPreparacaoEm: data(c.preparacao), ultimaCompletaEm: data(c.completa) };
    },
    async registrarPreparacao(e, completa, agora) {
      const iso = agora.toISOString();
      await redis.hset(
        chaveDoControle(e),
        completa ? { preparacao: iso, completa: iso } : { preparacao: iso },
      );
    },
  };
}

// Libera/renova só quem tem o token (compare-and-delete atômico).
const LIBERAR = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export function criarTravas(redis: Redis): Travas {
  const chave = (nome: string) => `${PREFIXO}:trava:${nome}`;
  return {
    async adquirir(nome, validadeMs) {
      const token = randomUUID().slice(0, 8);
      const ok = await redis.set(chave(nome), token, "PX", validadeMs, "NX");
      return ok === "OK" ? token : null;
    },
    async liberar(nome, token) {
      await redis.eval(LIBERAR, 1, chave(nome), token);
    },
  };
}
