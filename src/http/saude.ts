import { createHash, timingSafeEqual } from "node:crypto";

import { ErroDeNegocio } from "@erp/domain/errors";
import { type FastifyInstance } from "fastify";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

export interface Prontidao {
  /** Cada verificação lança se a dependência não responde. */
  verificacoes: Record<string, () => Promise<void>>;
}

/** `/saude/vivo` (processo de pé) e `/saude/pronto` (banco, Redis e consumidores respondendo). */
export function registrarSaude(app: FastifyInstance, prontidao: Prontidao) {
  app.get("/saude/vivo", { config: { rateLimit: false } }, () => ({ status: "ok" }));
  app.get("/saude/pronto", { config: { rateLimit: false } }, async (request) => {
    const falhas: string[] = [];
    for (const [nome, verificar] of Object.entries(prontidao.verificacoes)) {
      try {
        await verificar();
      } catch (erro) {
        request.log.warn({ err: erro, dependencia: nome }, "dependência fora");
        falhas.push(nome);
      }
    }
    if (falhas.length > 0) {
      throw new ErroDeNegocio("INDISPONIVEL", `Dependência indisponível: ${falhas.join(", ")}.`);
    }
    return { status: "pronto" };
  });
}

const resumo = (texto: string) => createHash("sha256").update(texto).digest();

function mesmoToken(recebido: string | undefined, esperado: string): boolean {
  return timingSafeEqual(resumo(recebido ?? ""), resumo(`Bearer ${esperado}`));
}

/** Métricas que os jobs alimentam (`main.ts`, eventos dos Workers do BullMQ). */
export interface MetricasDosJobs {
  concluido(job: string): void;
  falhou(job: string): void;
}

/**
 * Métricas Prometheus em `/metrics`, só com o token (a rota não existe sem ele): padrão do Node,
 * duração das requisições e jobs concluídos/falhos por nome.
 */
export function registrarMetricas(
  app: FastifyInstance,
  token: string | undefined,
): MetricasDosJobs | null {
  if (!token) return null;
  const registro = new Registry();
  collectDefaultMetrics({ register: registro });
  const duracao = new Histogram({
    name: "http_requisicao_duracao_segundos",
    help: "Duração das requisições HTTP",
    labelNames: ["metodo", "rota", "status"],
    registers: [registro],
  });
  const jobs = new Counter({
    name: "jobs_total",
    help: "Execuções de job terminadas, por nome e resultado",
    labelNames: ["job", "resultado"],
    registers: [registro],
  });

  app.addHook("onResponse", async (request, reply) => {
    duracao.observe(
      {
        metodo: request.method,
        // Padrão da rota (`/interno/v1/execucoes/:job/:execucaoId`), não a URL.
        rota: request.routeOptions.url ?? "desconhecida",
        status: String(reply.statusCode),
      },
      reply.elapsedTime / 1000,
    );
  });

  app.get("/metrics", { config: { rateLimit: false } }, async (request, reply) => {
    if (!mesmoToken(request.headers.authorization, token)) {
      throw new ErroDeNegocio("NAO_AUTENTICADO", "Token de métricas inválido.");
    }
    return reply.type(registro.contentType).send(await registro.metrics());
  });

  return {
    concluido: (job) => {
      jobs.inc({ job, resultado: "concluido" });
    },
    falhou: (job) => {
      jobs.inc({ job, resultado: "falhou" });
    },
  };
}
