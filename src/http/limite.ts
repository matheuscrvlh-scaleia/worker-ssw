import { type FastifyInstance, type onRequestAsyncHookHandler } from "fastify";

/**
 * Limite de taxa por IP para pôr NA FRENTE da autenticação (`onRequest: [limite, autenticar]`):
 * pela configuração da rota, o @fastify/rate-limit roda depois dos hooks da rota, e a tentativa
 * recusada pelo segredo nunca contaria. Cada nome tem o seu contador.
 */
export function limitePorMinuto(
  app: FastifyInstance,
  nome: string,
  max: number,
): onRequestAsyncHookHandler {
  return app.rateLimit({
    max,
    timeWindow: "1 minute",
    keyGenerator: (request) => `${nome}:${request.ip}`,
  });
}
