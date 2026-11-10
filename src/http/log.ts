import { erroParaLog } from "@erp/db";
import { type FastifyRequest } from "fastify";
import { type LoggerOptions } from "pino";

import { type Ambiente } from "../config/ambiente";

/**
 * Nada de segredo em log: token de serviço e do webhook (`Authorization`), segredos das rotas
 * públicas e qualquer campo `senha`/`token`/`segredo` dos objetos logados pelos jobs.
 * Mesma ideia de erp-ssw/apps/api/src/infra/log.ts.
 */
export const CAMINHOS_SENSIVEIS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-ftp-ingest-secret"]',
  'req.headers["x-cron-token"]',
  "senha",
  "*.senha",
  "token",
  "*.token",
  "segredo",
  "*.segredo",
];

/** Parâmetros de query que carregam segredo (o webhook do SSW manda `?secret=`). */
const PARAMETROS_SENSIVEIS = new Set(["secret", "token", "senha", "apikey", "key"]);

/** Devolve a URL com o valor dos parâmetros sensíveis trocado por `[oculto]`. */
export function mascararUrl(url: string): string {
  const inicioQuery = url.indexOf("?");
  if (inicioQuery === -1) return url;
  const caminho = url.slice(0, inicioQuery);
  const pares = url
    .slice(inicioQuery + 1)
    .split("&")
    .map((par) => {
      const igual = par.indexOf("=");
      const nome = igual === -1 ? par : par.slice(0, igual);
      let decodificado = nome;
      try {
        decodificado = decodeURIComponent(nome);
      } catch {
        // Nome mal codificado: compara como veio.
      }
      return PARAMETROS_SENSIVEIS.has(decodificado.toLowerCase()) ? `${nome}=[oculto]` : par;
    });
  return `${caminho}?${pares.join("&")}`;
}

/** Opções do pino do processo inteiro (Fastify e jobs usam o mesmo logger). */
export function opcoesDeLog(ambiente: Ambiente): LoggerOptions {
  return {
    level: ambiente.NODE_ENV === "test" ? "silent" : ambiente.LOG_NIVEL,
    redact: { paths: CAMINHOS_SENSIVEIS, censor: "[oculto]" },
    base: { servico: "worker-ssw" },
    serializers: {
      // Erro do Drizzle leva SQL e parâmetros na mensagem: sai sem eles.
      err: erroParaLog,
      req: (req: FastifyRequest) => ({
        method: req.method,
        url: mascararUrl(req.url),
        host: req.host,
        remoteAddress: req.ip,
        headers: req.headers,
      }),
    },
  };
}
