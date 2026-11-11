# syntax=docker/dockerfile:1.12
#
# worker-ssw: rotas públicas + HTTP interno + consumidores BullMQ num processo só.
#   docker build -t worker-ssw:local .
#
# Mesmo esquema do erp-ssw (infra/docker/worker.Dockerfile): bun para instalar e empacotar, Node
# 22 distroless sem root para rodar. Imagens fixadas por digest (as mesmas do ERP).
ARG BUN_IMAGEM=oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61
ARG NODE_IMAGEM=gcr.io/distroless/nodejs22-debian13:nonroot@sha256:1b90ca047c3a1046ad3527998c747c25b6a88dde91ba8c71b98669d5813aaa21

FROM ${BUN_IMAGEM} AS deps
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY tsconfig.json build.mjs ./
COPY src src
RUN bun run build

FROM ${BUN_IMAGEM} AS deps-producao
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts --production \
    && rm -rf node_modules/.cache

FROM ${NODE_IMAGEM} AS final
ARG VERSAO=dev
ARG COMMIT=desconhecido
ARG CRIADO_EM=
LABEL org.opencontainers.image.title="worker-ssw" \
      org.opencontainers.image.description="Ingestão SSW do ERP (rotas públicas, HTTP interno e BullMQ)" \
      org.opencontainers.image.version="${VERSAO}" \
      org.opencontainers.image.revision="${COMMIT}" \
      org.opencontainers.image.created="${CRIADO_EM}" \
      org.opencontainers.image.licenses="UNLICENSED"

ENV NODE_ENV=production \
    PORTA=3000
WORKDIR /app
COPY package.json ./package.json
COPY --from=deps-producao /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER 65532:65532
EXPOSE 3000

# 200 = banco, Redis e consumidores do BullMQ respondendo (src/http/saude.ts).
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORTA||3000)+'/saude/pronto').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Comando da virada (troca só o CMD; o ENTRYPOINT é o node):
#   docker compose run --rm worker-ssw dist/main.js reconstruir-projecoes --todas
CMD ["--enable-source-maps", "dist/main.js"]
