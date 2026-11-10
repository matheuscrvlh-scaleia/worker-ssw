import { type Redis } from "ioredis";

/** Contagem por chave numa janela fixa (ex.: falhas do webhook por IP por minuto). */
export interface ContadorPorJanela {
  /** Soma um e devolve o total da janela atual. */
  somar(chave: string): Promise<number>;
}

export function criarContadorRedis(
  redis: Redis,
  prefixo: string,
  janelaMs: number,
): ContadorPorJanela {
  return {
    somar: async (chave) => {
      const resultado = await redis
        .multi()
        .incr(`${prefixo}:${chave}`)
        .pexpire(`${prefixo}:${chave}`, janelaMs, "NX")
        .exec();
      return Number(resultado?.[0]?.[1] ?? 0);
    },
  };
}
