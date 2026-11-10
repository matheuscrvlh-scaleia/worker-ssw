import { describe, expect, it } from "vitest";

import { appDeTeste, dependenciasDeTeste } from "../testes/http";
import { mascararUrl } from "./log";

const METRICAS = "m".repeat(40);

describe("saúde e métricas", () => {
  it("vivo sempre; pronto só com as dependências respondendo", async () => {
    let redisNoAr = true;
    const app = await appDeTeste({
      prontidao: {
        verificacoes: {
          banco: () => Promise.resolve(),
          redis: () => (redisNoAr ? Promise.resolve() : Promise.reject(new Error("fora"))),
        },
      },
    });
    expect((await app.inject({ url: "/saude/vivo" })).json()).toEqual({ status: "ok" });
    expect((await app.inject({ url: "/saude/pronto" })).json()).toEqual({ status: "pronto" });
    redisNoAr = false;
    const fora = await app.inject({ url: "/saude/pronto" });
    expect(fora.statusCode).toBe(503);
    expect(fora.json()).toMatchObject({ erro: { mensagem: "Dependência indisponível: redis." } });
    await app.close();
  });

  it("/metrics só existe com token e só pela rede interna", async () => {
    const semToken = await appDeTeste();
    expect((await semToken.inject({ url: "/metrics" })).statusCode).toBe(404);
    await semToken.close();

    const app = await appDeTeste({
      ambiente: { ...dependenciasDeTeste().ambiente, METRICAS_TOKEN: METRICAS },
    });
    expect((await app.inject({ url: "/metrics" })).statusCode).toBe(401);
    const ok = await app.inject({
      url: "/metrics",
      headers: { authorization: `Bearer ${METRICAS}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain("process_cpu_seconds_total");
    const pelaBorda = await app.inject({
      url: "/metrics",
      headers: { authorization: `Bearer ${METRICAS}`, "x-forwarded-for": "203.0.113.9" },
    });
    expect(pelaBorda.statusCode).toBe(404);
    await app.close();
  });
});

describe("log sem segredo", () => {
  it("mascara o segredo da query (o webhook manda ?secret=)", () => {
    expect(mascararUrl("/api/public/ssw-ocorrencias?empresa=fr&secret=abc")).toBe(
      "/api/public/ssw-ocorrencias?empresa=fr&secret=[oculto]",
    );
    expect(mascararUrl("/x?Token=1&%73ecret=2")).toBe("/x?Token=[oculto]&%73ecret=[oculto]");
    expect(mascararUrl("/saude/vivo")).toBe("/saude/vivo");
  });
});
