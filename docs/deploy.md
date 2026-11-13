# Deploy do worker-ssw

`docker-compose.yml`: o worker-ssw e o seu Redis. A aplicação escuta na 3000 dentro do contêiner
e fica publicada na 3002 do host.

## 1. Antes da primeira subida

1. No ERP: o Caddy encaminha `/api/public/*` a `<host>:3002`; a API chama
   `http://<host>:3002/interno/v1` com `WORKER_SSW_TOKEN`.
2. No banco: papel `erp_worker` (sem `BYPASSRLS`) com os GRANTs da lista do README. O worker-ssw
   não cria nada no banco; se faltar coluna ou GRANT ele recusa subir e diz qual.
3. `cp .env.example .env` e preencher (`chmod 600 .env`). `certs/` com a CA do Supabase.
   `SEGREDOS_CHAVES` são as mesmas do ERP; `INTERNO_TOKENS` contém o `WORKER_SSW_TOKEN` do ERP.

## 2. Subir e atualizar

```bash
git clone https://github.com/matheuscrvlh-scaleia/worker-ssw.git ~/worker-ssw  # 1ª vez
git pull --ff-only
docker compose up -d --build
docker compose ps              # worker-ssw "healthy" = banco, Redis e consumidores ok
```

Na virada, depois de ligar, reconstruir as projeções do Romaneio a partir da staging INTEIRA do
`public` do sistema atual (o `erp.ingestao_linhas` só tem 60 dias; sem a origem, as viagens
antigas se perdem):

```bash
# ORIGEM_URL = conexão do sistema atual com o papel postgres (fica só no shell, nunca no .env)
docker compose run --rm --no-deps worker-ssw dist/main.js reconstruir-projecoes --todas \
  --origem-url "$ORIGEM_URL" --confirmar-producao
```

A origem abre em só leitura (`default_transaction_read_only = on`) e só recebe `select`; a gravação
é no `erp`. Sem `--confirmar-producao`, uma URL do projeto de produção é recusada. Sem
`--origem-url`, o comando lê `erp.ingestao_linhas` (conciliação do dia a dia). Só então
`AGENDAMENTOS_LIGADOS=true` e `INGESTAO_JOBS_LIGADOS` com os jobs desse ambiente, e
`docker compose up -d` de novo.

## 3. Voltar

`git checkout <commit anterior>` e `docker compose up -d --build` (depois, `git checkout main`).
Não há migration a desfazer: o schema é do ERP. Se o ERP mudou o schema e a versão antiga não
confere mais, ela recusa subir (log `worker-ssw não sobe`, com a lista do que diverge).

## 4. Logs

```bash
docker compose logs -f --since 10m worker-ssw
docker compose logs worker-ssw | grep '"level":50'    # erros (pino: 50 = error, 60 = fatal)
```

JSON do pino, `service: "worker-ssw"`. Cabeçalhos de autorização, segredos na query e campos de
senha/token saem mascarados.

## 5. Orçamento de conexões do Postgres

Cada processo abre até `DB_MAX_CONEXOES` (padrão 5). No pior caso o worker-ssw usa:

| Situação                                    | Conexões                     |
| ------------------------------------------- | ---------------------------- |
| Rodando normal                              | 5                            |
| `reconstruir-projecoes` com o serviço no ar | 10 (+1 na origem, se houver) |

Some isso ao que o ERP já usa (API × réplicas + worker do ERP + migrador) e confira contra o
limite do pooler do Supabase antes de subir `DB_MAX_CONEXOES`.

## 6. SSW web por outro IP (provisório)

Se o SSW recusar o IP da VPS (403 ou conexão sem resposta em `sistema`/`tms.ssw.inf.br`), o
Chromium do `baixar-relatorios-ssw` sai pelo WARP da Cloudflare, **em modo proxy** (modo túnel
desviaria todo o tráfego da VPS, SSH e ERP inclusive):

```bash
apt-get install cloudflare-warp socat          # repositório pkg.cloudflareclient.com
warp-cli --accept-tos registration new
warp-cli --accept-tos mode proxy && warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos connect                  # SOCKS5 em 127.0.0.1:40000
# repasse só na rede do Docker (unit warp-ponte-docker): docker0 = 172.17.0.1
socat TCP-LISTEN:40001,bind=172.17.0.1,reuseaddr,fork TCP:127.0.0.1:40000
```

No `.env`: `SSW_WEB_PROXY=socks5://host.docker.internal:40001` (o compose mapeia
`host.docker.internal`). Quando o SSW liberar o IP da VPS, apagar a variável e
`docker compose up -d`.
