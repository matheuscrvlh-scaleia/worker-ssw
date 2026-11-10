# ADR 0001 — Origem: worker-ssw apartado do ERP SSW

- Situação: aceita (10/11/2026)
- Decisão de origem: ADR 0012 do ERP SSW (`erp-ssw/docs/adr/0012-worker-ssw-apartado.md`)

## Contexto

O dono quis o trabalho com o SSW fora do back e do front do ERP: um sistema próprio, com Docker,
Node e Fastify. A ADR 0012 do ERP é o contrato deste repositório: o que ele faz, as rotas
públicas, o HTTP interno, o papel no banco e o deploy.

## Decisão

Seguir a ADR 0012 sem reinterpretar. Em resumo:

- Grava direto no schema `erp` do Postgres do ERP, com o papel `erp_worker` e RLS (contexto por
  transação com `SET LOCAL`). Não cria nada no banco; confere as colunas no boot.
- Leva cópia própria do código de que precisa (núcleo do CT-e, ingestão, tabelas). Os espelhos
  ficam byte a byte iguais aos do ERP (lista no README) para a sincronia ser um `diff`.
- Os jobs que não falam com o SSW ficam no ERP.
- O ERP pede jobs pelo HTTP interno (`src/contrato-interno.ts`) e lê o estado no banco.
- Compose próprio com Redis próprio; a rede externa `erp-interna` liga o Caddy e a API do ERP.

Mudança no contrato (rotas, jobs pedíveis, tabelas) começa por uma ADR nova no ERP e só depois
chega aqui.

## Consequências

- Duas cópias do núcleo do CT-e: regra nova vai aos dois repositórios, guiada pela lista de
  arquivos copiados do README.
- Schema acoplado ao do ERP: migration do ERP que mexa numa coluna usada aqui faz o worker-ssw
  recusar subir até a cópia em `src/banco/schema/` ser atualizada.
