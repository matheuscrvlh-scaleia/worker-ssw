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

/** Só para os testes (sem Redis). */
export function criarContadorEmMemoria(
  janelaMs: number,
  agora: () => number = Date.now,
): ContadorPorJanela {
  const janelas = new Map<string, { ate: number; total: number }>();
  return {
    somar: (chave) => {
      const atual = janelas.get(chave);
      const janela = atual && atual.ate > agora() ? atual : { ate: agora() + janelaMs, total: 0 };
      janela.total += 1;
      janelas.set(chave, janela);
      return Promise.resolve(janela.total);
    },
  };
}
