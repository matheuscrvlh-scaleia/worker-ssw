# Deploy do worker-ssw

Um `compose` próprio (`compose.yaml`): o worker-ssw e o seu Redis. Fica na mesma VPS do ERP ou
noutra; o que liga os dois é a rede Docker externa `erp-interna` (ADR 0012 do ERP).

## 1. Antes da primeira subida

1. No ERP: criar a rede `erp-interna` (`docker network create --internal erp-interna`) e ligar
   o Caddy e a API do ERP a ela. O Caddy encaminha `/api/public/*` a `worker-ssw:3000`; a API
   chama `http://worker-ssw:3000/interno/v1` com `WORKER_SSW_TOKEN`.
2. No banco: papel `erp_worker` (sem `BYPASSRLS`) com os GRANTs da lista do README. O worker-ssw
   não cria nada no banco; se faltar coluna ou GRANT ele recusa subir e diz qual.
3. `cp .env.example .env` e preencher (`chmod 600 .env`). `certs/` com a CA do Supabase.
   `SEGREDOS_CHAVES` são as mesmas do ERP; `INTERNO_TOKENS` contém o `WORKER_SSW_TOKEN` do ERP.

## 2. Subir

```bash
git clone https://github.com/matheuscrvlh-scaleia/worker-ssw.git ~/worker-ssw  # 1ª vez
docker compose build           # imagem worker-ssw:local, a partir do código
docker compose up -d
docker compose ps              # worker-ssw "healthy" = banco, Redis e consumidores ok
```

Na virada, depois de ligar, reconstruir as projeções do Romaneio a partir da staging INTEIRA do
`public` do sistema atual (o `erp.ingestao_linhas` só tem 60 dias; sem a origem, as viagens
antigas se perdem):

```bash
# ORIGEM_URL = conexão do sistema atual com o papel postgres (fica só no shell, nunca no .env)
docker compose run --rm worker-ssw dist/main.js reconstruir-projecoes --todas \n  --origem-url "$ORIGEM_URL" --confirmar-producao
```

A origem abre em só leitura (`default_transaction_read_only = on`) e só recebe `select`; a gravação
é no `erp`. Sem `--confirmar-producao`, uma URL do projeto de produção é recusada. Sem
`--origem-url`, o comando lê `erp.ingestao_linhas` (conciliação do dia a dia). Só então
`AGENDAMENTOS_LIGADOS=true` e `INGESTAO_JOBS_LIGADOS` com os jobs desse ambiente, e
`docker compose up -d` de novo.

## 3. Atualizar sem queda

Sobe a réplica nova ao lado da antiga, espera ficar saudável e só então para a antiga (o Caddy
segue mandando para quem responde; o BullMQ não entrega o mesmo job a duas réplicas):

```bash
git pull --ff-only
docker compose build worker-ssw
antiga=$(docker compose ps -q worker-ssw)
docker compose up -d --no-deps --no-recreate --scale worker-ssw=2 worker-ssw
docker compose ps worker-ssw   # repetir até a nova estar "healthy"
docker stop --time 30 "$antiga" && docker rm "$antiga"
docker compose up -d --no-deps --no-recreate --scale worker-ssw=1 worker-ssw
```

Se a nova não ficar saudável: `docker logs <nova>`, `docker rm -f <nova>`; a antiga segue no ar.

## 4. Voltar

`git checkout <commit anterior>` e o mesmo passo da seção 3 sem o `git pull` (depois, `git checkout main`). Não há migration a desfazer: o schema
é do ERP. Se o ERP mudou o schema e a versão antiga não confere mais, ela recusa subir (log
`worker-ssw não sobe`, com a lista do que diverge) e a nova continua no ar.

## 5. Logs

```bash
docker compose logs -f --since 10m worker-ssw
docker compose logs worker-ssw | grep '"level":50'    # erros (pino: 50 = error, 60 = fatal)
```

JSON do pino, `service: "worker-ssw"`. Cabeçalhos de autorização, segredos na query e campos de
senha/token saem mascarados. Rotação: 5 arquivos de 20 MB por contêiner.

## 6. Orçamento de conexões do Postgres

Cada processo abre até `DB_MAX_CONEXOES` (padrão 5). No pior caso o worker-ssw usa:

| Situação                                    | Conexões                     |
| ------------------------------------------- | ---------------------------- |
| Rodando normal                              | 5                            |
| Durante a atualização (duas réplicas)       | 10                           |
| `reconstruir-projecoes` com o serviço no ar | 10 (+1 na origem, se houver) |

Some isso ao que o ERP já usa (API × réplicas + worker do ERP + migrador) e confira contra o
limite do pooler do Supabase antes de subir `DB_MAX_CONEXOES`.
