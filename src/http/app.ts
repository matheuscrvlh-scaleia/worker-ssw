import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { type Redis } from "ioredis";

import { type Ambiente } from "../config/ambiente";
import { PREFIXO_INTERNO } from "../contrato-interno";
import { muitasTentativas, registrarTratadorDeErros, responder } from "./erros";
import { type OpcoesDoInterno, rotasInternas } from "./interno";
import { rotasPublicasDaIngestao } from "./publico/ingestao";
import { type ServicosDaIngestao } from "./publico/servicos";
import { type OpcoesDoWebhookPublico, rotasPublicasSsw } from "./publico/webhook";
import { type MetricasDosJobs, type Prontidao, registrarMetricas, registrarSaude } from "./saude";

export interface DependenciasHttp {
  ambiente: Pick<Ambiente, "PROXIES_CONFIAVEIS" | "METRICAS_TOKEN">;
  log: FastifyBaseLogger;
  /** Contador do limite de taxa. Nulo só nos testes (fica na memória do processo). */
  redis: Redis | null;
  agora: () => Date;
  ingestao: ServicosDaIngestao;
  webhook: Omit<OpcoesDoWebhookPublico, "agora">;
  interno: OpcoesDoInterno;
  prontidao: Prontidao;
}

/** Só pela rede interna: o que chega pela borda (Caddy) traz X-Forwarded-For. */
const CAMINHOS_INTERNOS = [`${PREFIXO_INTERNO}/`, "/metrics"];

/**
 * Um Fastify só para as três portas de entrada: rotas públicas (mesmas URLs do ERP, pela borda),
 * HTTP interno (ERP → worker-ssw) e saúde/métricas. Não abre porta: `main.ts` escuta, os testes
 * usam `inject`.
 */
export async function construirApp(
  deps: DependenciasHttp,
): Promise<{ app: FastifyInstance; metricas: MetricasDosJobs | null }> {
  const app = Fastify({
    loggerInstance: deps.log,
    // Só confia no X-Forwarded-For dos proxies conhecidos (o IP do cliente vale para o limite).
    trustProxy: (_endereco: string, salto: number) => salto < deps.ambiente.PROXIES_CONFIAVEIS,
    bodyLimit: 1_048_576,
    requestIdHeader: "x-request-id",
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registrarTratadorDeErros(app);

  // Defesa em profundidade: a borda só encaminha /api/public/*; se um dia encaminhar mais, o
  // HTTP interno e as métricas continuam fora do alcance da internet.
  app.addHook("onRequest", async (request, reply) => {
    const interno = CAMINHOS_INTERNOS.some((c) => request.url.startsWith(c));
    if (interno && request.headers["x-forwarded-for"] !== undefined) {
      return responder(reply, "NAO_ENCONTRADO", "Rota não encontrada.");
    }
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    ...(deps.redis ? { redis: deps.redis, nameSpace: "worker-ssw-limite:" } : {}),
    errorResponseBuilder: () => muitasTentativas(),
  });

  registrarSaude(app, deps.prontidao);
  const metricas = registrarMetricas(app, deps.ambiente.METRICAS_TOKEN);
  await app.register(rotasPublicasDaIngestao, { servicos: deps.ingestao, agora: deps.agora });
  await app.register(rotasPublicasSsw, { ...deps.webhook, agora: deps.agora });
  await app.register(rotasInternas, deps.interno);
  return { app, metricas };
}
