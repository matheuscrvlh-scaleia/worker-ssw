# worker-ssw

Sistema que conversa com o SSW pelo ERP SSW: baixa os relatórios do SSW web (ou os recebe do FTP),
recebe o webhook de ocorrências, consulta o BI2 e a API do SSW e grava tudo direto no schema `erp` do Postgres do
ERP. Saiu do monorepo `erp-ssw` pela [ADR 0012 do ERP](docs/adr/0001-origem.md).

## O que faz

- **Rotas públicas** (mesmas URLs e respostas do ERP; o Caddy do ERP encaminha `/api/public/*`):
  - `POST /api/public/ftp-relatorio-import` (relatório do FTP, até 64 MiB, 240/min por IP);
  - `POST /api/public/ssw-ciclo-aplicar` (120/min) e `POST /api/public/xml-orfaos-retry` (30/min);
  - `GET|POST /api/public/ssw-ocorrencias` (webhook SSW2181, 6000/min por IP e 30 falhas/min).
  - Segredo por empresa (ADR 0010 do ERP), autenticação antes de ler o corpo, quarentena de token
    errado (ADR 0009 do ERP) e limite de taxa contado antes da autenticação.
- **HTTP interno** `/interno/v1/*` para a API do ERP pedir e acompanhar jobs e fazer as operações
  manuais da tela Admin › Importação SSW: retomar e descartar ciclo, importar relatório ou XML/zip
  à mão, aplicar ou simular, ver, pausar e destravar o FTP (contrato abaixo).
- **Relatórios do SSW web** (`baixar-relatorios-ssw`, ADR 0018 do ERP): para cada empresa com a
  integração `ssw_web` ligada, às :00 e :30, entra no SSW web com o Chromium (Playwright) e baixa
  036, 306, 038 por unidade, 455 e 930 (fila da opção 156) e 050 (impresso convertido em CSV). Os
  arquivos vão direto à recepção da ingestão (os mesmos nomes do FTP) e o ciclo roda em seguida.
  Credencial e unidades vêm do cadastro da integração no ERP (`dominio`, `cpf`, `usuario`,
  `unidade_matriz`, `unidades_038`, `unidades_038_so_com_dados`, `unidades_050`; senha cifrada).
  Até 2 navegadores ao mesmo tempo no worker-ssw todo.
- **Jobs BullMQ**: sincronização do FTP (e retroativo), aplicação dos ciclos, BI2 0017, token e
  webhook do SSW, órfãos do XML de CT-e, projeções do Romaneio (por chave e completa), SLA pelos
  arquivos, coletas do 050 e limpeza da ingestão antiga.
- **Saúde**: `/saude/vivo`, `/saude/pronto` (banco, Redis e consumidores) e `/metrics` (Bearer
  `METRICAS_TOKEN`). `/interno/*` e `/metrics` respondem 404 a quem vem pela borda
  (`X-Forwarded-For`).
- **Comando** `reconstruir-projecoes --empresa <uuid> | --todas`, com `--origem-url <conexão>`
  (e `--confirmar-producao` se for produção) na virada: lê a staging inteira do `public` do sistema
  atual, só leitura, e grava no `erp` (`docs/deploy.md`).

## O que não faz

- Não cria nem altera nada de schema: sem migration, função, gatilho, view materializada,
  extensão ou cron. O schema é do ERP; no boot o worker-ssw confere as colunas que usa e recusa
  subir se faltar alguma.
- Não tem tela nem sessão de usuário: a tela é do ERP, que valida o pedido, audita quem pediu e
  chama o HTTP interno. As leituras puras da tela (pipeline, histórico de aplicações, de
  sincronizações e de arquivos XML) o ERP faz direto no banco.
- Não roda os jobs do ERP que não falam com o SSW (prazos, recálculo, sessões, recifrar segredos).

## Rodar localmente

```bash
bun install
cp .env.example .env              # preencher DATABASE_URL (DEVELOP), REDIS_URL, tokens e chaves
bun run dev                       # node --watch com tsx, lê o .env
bun run typecheck && bun run lint && bun run test
bun run build && bun run start    # bundle em dist/main.js
bun run reconstruir-projecoes -- --empresa <uuid>
```

Nunca apontar para o banco de produção. Os testes não usam rede: banco, Redis, SFTP e SSW são
falsos (`src/testes/`).

## Variáveis

| Variável                 | Padrão                       | Uso                                                                                                                                                   |
| ------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           | —                            | Postgres do ERP, papel `erp_worker` (sem `BYPASSRLS`)                                                                                                 |
| `DB_MAX_CONEXOES`        | `5`                          | Tamanho do pool                                                                                                                                       |
| `DB_TIMEOUT_CONSULTA_MS` | `120000`                     | `statement_timeout` das consultas                                                                                                                     |
| `REDIS_URL`              | —                            | Redis próprio (filas, travas, token do SSW cifrado, limites)                                                                                          |
| `PORTA` / `HOST`         | `3000`/`0.0.0.0`             | Porta única: público, interno, saúde e métricas                                                                                                       |
| `PROXIES_CONFIAVEIS`     | `1`                          | Saltos confiáveis no `X-Forwarded-For` (o Caddy do ERP)                                                                                               |
| `WORKERS_LIGADOS`        | `true`                       | Consumidores do BullMQ neste processo                                                                                                                 |
| `AGENDAMENTOS_LIGADOS`   | `false`                      | Crons; ligar só no ambiente que ingere                                                                                                                |
| `INGESTAO_JOBS_LIGADOS`  | vazio                        | Jobs que o agendador dispara (`bi2-0017,verificar-token-ssw,...`)                                                                                     |
| `INTERNO_TOKENS`         | vazio                        | Tokens do HTTP interno (`atual,anterior`, 32+ caracteres); vazio = 503                                                                                |
| `METRICAS_TOKEN`         | —                            | Bearer do `/metrics`; sem ele, `/metrics` não existe                                                                                                  |
| `SEGREDOS_CHAVES`        | —                            | Chaves mestras dos segredos de integração (`1:<base64>,2:...`), as do ERP                                                                             |
| `SEGREDOS_CHAVE_ATUAL`   | `1`                          | Chave usada para cifrar (token do SSW no Redis)                                                                                                       |
| `SFTP_*`                 | —                            | SFTP só para integração com `parametros.usar_env` (transição da FR)                                                                                   |
| `SSW_WEB_URL`            | `https://sistema.ssw.inf.br` | Endereço do SSW web (`baixar-relatorios-ssw`); ex.: o provisório `https://tms.ssw.inf.br`                                                             |
| `SSW_WEB_PROXY`          | —                            | Proxy só do Chromium do SSW web, quando o SSW recusa o IP da VPS (ex.: WARP da Cloudflare em `socks5://host.docker.internal:40001`; `docs/deploy.md`) |
| `NODE_ENV` / `LOG_NIVEL` | `development`/`info`         | Ambiente e nível do pino                                                                                                                              |

No compose ainda entra `REDIS_SENHA` (ver `.env.example` e `docs/deploy.md`).

## Contrato do HTTP interno

Fonte: `src/contrato-interno.ts` (só depende de `zod`; o ERP copia o arquivo) com exemplos
testados em `EXEMPLOS`. Autenticação: `Authorization: Bearer <token>`, comparado em tempo
constante contra cada valor de `INTERNO_TOKENS`. Sem token configurado: 503; token errado: 401.
Erros no formato `{ "erro": { "codigo", "mensagem" } }`, em português, para o operador.

| Método | Caminho                                     | Entrada                        | Saída                                                                      |
| ------ | ------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------- |
| POST   | `/interno/v1/empresas/:empresaId/execucoes` | `{ job, dados?, deduplicar? }` | `202 { execucaoId }`; `409` se já há um igual na fila                      |
| GET    | `/interno/v1/execucoes/:job/:execucaoId`    | `?aguardarMs=0..60000`         | `{ estado: na_fila \| rodando \| concluida \| falhou, resultado?, erro? }` |
| GET    | `/interno/v1/empresas/:empresaId/situacao`  | —                              | `{ jobs: [...], aplicacao: { pendentes, rodando }, tokenSswGeradoEm? }`    |

Jobs que se pode pedir (`JOBS_PEDIVEIS`) e os seus `dados`:

| Job                           | `dados`                                        |
| ----------------------------- | ---------------------------------------------- |
| `sincronizar-ftp`             | `{ manual? }`                                  |
| `sincronizar-ftp-retroativo`  | `{}`                                           |
| `baixar-relatorios-ssw`       | `{}`                                           |
| `aplicar-ciclos`              | `{}`                                           |
| `bi2-0017`                    | `{ modo?, data?, lookback? }`                  |
| `verificar-token-ssw`         | `{ manual? }` (`manual: true` gera token novo) |
| `processar-webhook-ssw`       | `{ eventoId, protocolo }`                      |
| `reprocessar-xml-orfaos`      | `{ limite? }`                                  |
| `projecoes-romaneio`          | `{ chaves: [{ sigla, numero }] }`              |
| `projecoes-romaneio-completa` | `{}`                                           |

`deduplicar: true` usa um id fixo por job e empresa (no webhook, por evento): o segundo pedido
enquanto o primeiro está na fila volta 409. Os erros de execução saem genéricos
("Falha ao executar o job...") quando não são de negócio; o detalhe fica só no log.

Na situação, cada job de `JOBS_ACOMPANHADOS` (os pedíveis, `sla-arquivos` e
`limpar-ingestao-arquivos`: todos os do Diagnóstico SSW) traz `estado`, `ultimaExecucao?`,
`proximaExecucao?`, `agendado`, as contagens da fila do job (todas as empresas: `naFila`, `rodando`,
`atrasados`, `falhos`) e `ultimasFalhas` (até 3 da empresa: `execucaoId`, `quando`, `erro`,
`tentativas`). `aplicacao` é a fila de aplicação da empresa ("Na fila" da Importação SSW) e se a
aplicação está rodando.

### Operações manuais (Admin › Importação SSW)

Síncronas, com as mesmas respostas que a tela já usa. Base: `/interno/v1/empresas/:empresaId`.

| Método | Caminho                    | Entrada                                                           | Saída                                                                         |
| ------ | -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/ciclos/:chave/retomar`   | —                                                                 | `{ cicloChave, status, motivo }`                                              |
| POST   | `/ciclos/:chave/descartar` | `{ motivo? }` (3 a 500 caracteres)                                | `{ cicloChave, totalRemovido }` e projeções na fila                           |
| POST   | `/relatorios`              | `{ relatorio, nomeArquivo, conteudoBase64, aceitarDivergencia? }` | `{ loteId, gravados, erros }`                                                 |
| POST   | `/aplicacoes`              | `{ simular, limite?, offset? }`                                   | resumo do bloco (`dryRun`, totais, listas, `temMais`, `romaneio036`)          |
| GET    | `/ftp`                     | —                                                                 | `{ ativo, agenda, travaAtiva, progresso }`                                    |
| PUT    | `/ftp/ativo`               | `{ ativo }`                                                       | `{ ok: true }`                                                                |
| POST   | `/ftp/liberar-trava`       | —                                                                 | `{ ok: true }`                                                                |
| POST   | `/xml`                     | `{ nomeArquivo, conteudoBase64 }` (`.xml` ou `.zip`)              | `{ arquivo, status, ctesProcessados, cancelamentos, orfaos, pulados, erros }` |

- `relatorio` é `036`, `038`, `306`, `455csv` ou `930`; o conteúdo é o texto do CSV em UTF-8,
  em base64. Cabeçalho divergente: 422, a não ser com `aceitarDivergencia: true`.
- Relatório e XML aceitam até 64 MB de arquivo (corpo maior só nessas duas rotas; nas outras, 1
  MiB). O zip segue os tetos contra zip bomba (10 MB por XML, 256 MB no total).
- Aplicar de verdade com a aplicação automática rodando: 409. Simular não pega a trava.
- Ciclo inexistente: 404; ciclo já aplicado não se descarta: 409.

## Banco: o que o papel `erp_worker` precisa

Todas as colunas copiadas em `src/banco/schema/` precisam de ao menos `SELECT` (o boot confere
pelo `information_schema.columns`, que só mostra coluna com privilégio). Por tabela:

| Privilégios                           | Tabelas                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELECT`                              | `empresas`, `filiais`, `filiais_apelidos`, `prazos_configurados`, `feriados`, `ingestao_relatorios_esperados`                                                                            |
| `SELECT`, `UPDATE` de colunas         | `empresa_integracoes`: `UPDATE (ultimo_teste_em, ultimo_teste_ok, ultimo_teste_msg)`                                                                                                     |
| `SELECT, INSERT`, `UPDATE` de colunas | `configuracoes` (pausa do FTP): `UPDATE (valor, atualizado_em, atualizado_por)`                                                                                                          |
| `INSERT`                              | `auditoria`, `cte_prazo_historico`                                                                                                                                                       |
| `SELECT, INSERT`                      | `codigos_ocorrencia` (código novo visto no relatório ou no webhook)                                                                                                                      |
| `SELECT, INSERT, UPDATE`              | `ctes`, `coletas`, `xml_cte_itens`                                                                                                                                                       |
| `SELECT, INSERT, DELETE`              | `ingestao_erros`, `xml_ftp_sincronizacoes`, `bi2_sincronizacoes`, `romaneio_viagens_cte`, `romaneio_saidas_cte`, `romaneio_cte_atual`, `romaneio_conferente_cte`, `cte_dados_relatorios` |
| `SELECT, INSERT, UPDATE, DELETE`      | `ocorrencias`, `ingestao_ciclos`, `ingestao_arquivos`, `ingestao_linhas`, `ingestao_aplicacoes`, `xml_cte_arquivos`, `xml_cte_orfaos`, `ssw_webhook_eventos`, `bi2_bruto`                |
| `SELECT, DELETE`                      | `ssw_sincronizacoes` (só a limpeza por idade)                                                                                                                                            |

`SELECT` aparece mesmo onde só se grava porque `UPDATE`/`DELETE` com `WHERE`, `RETURNING` e
`INSERT ... ON CONFLICT DO UPDATE` leem as colunas. Onde está o acesso: `src/infra/repositorio.ts`,
`src/infra/projecoes-romaneio.ts`, `src/infra/coletas-050.ts`, `src/fontes/*/repositorio*.ts`,
`src/http/publico/repositorio.ts` e `src/jobs/*/repositorio.ts`.

## Arquivos copiados do erp-ssw

**Espelhos** (byte a byte; mudança no ERP é copiada para cá, e a sincronia é um `diff -r`). Os
nomes de arquivo e pasta são os do ERP, em inglês (ADR 0017 do ERP):

| Origem (erp-ssw)                                                                                                                                                     | Destino                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/api/src/domain/{core,manifest,pickups,ingestion,performance}/` (os arquivos usados) e `collections.ts`, `settings.ts`, `companies.ts`, `errors.ts`, `order.ts` | `src/domain/` (mesmos caminhos)                                  |
| `apps/api/src/models/common/` (`access/roles`, `query`, `dates`, `domain/deadline`, `errors`, `ingestion`, `platform`, `ssw-reports`, `zod`)                         | `src/compartilhado/` (mesmos caminhos)                           |
| `apps/api/src/views/contract.ts` e `apps/api/src/views/contracts/{pickups,manifest}.ts`                                                                              | `src/compartilhado/contract.ts` e `src/compartilhado/contracts/` |
| `apps/api/src/db/{index,client,errors,secrets}.ts`                                                                                                                   | `src/banco/`                                                     |

Só existem aqui (o ERP apagou ao passar a ingestão para cá, ADR 0012): `ingestion/bi2-0017.ts`,
`ingestion/webhook-ssw.ts`, `manifest/projections.ts`, `core/scope.ts`, `performance/sla-files.ts`,
`tests/` e os `*.test.ts`. `src/domain/core/deadline.test.ts` usa uma lista fixa de feriados de
2026 no lugar de `calendar.ts` (que não veio).

Os imports `@erp/domain/*`, `@erp/shared/*` e `@erp/db*` são os mesmos do ERP e são resolvidos pelo
`tsconfig.json` (`paths`) e pelo `vitest.config.ts`.

**Schema**: `src/banco/schema/*.ts`, só as 32 tabelas usadas e só as colunas (sem índices, chaves
estrangeiras nem policies; quem manda no schema é o ERP, hoje nas migrations em SQL de
`apps/api/migrations/`).

**Movidos e adaptados** (com os testes, quando havia; caminhos de origem da época da mudança, antes
da reorganização do ERP):

| Origem (erp-ssw)                                                                         | Destino                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `packages/ingestao/src/casos-de-uso/aplicar.ts`                                          | `src/aplicacao/casos-de-uso/aplicar.ts`                      |
| `packages/ingestao/src/casos-de-uso/casos-de-uso.test.ts`                                | `src/aplicacao/casos-de-uso/casos-de-uso.test.ts`            |
| `packages/ingestao/src/casos-de-uso/ciclo.ts`                                            | `src/aplicacao/casos-de-uso/ciclo.ts`                        |
| `packages/ingestao/src/casos-de-uso/empresa.ts`                                          | `src/aplicacao/casos-de-uso/empresa.ts`                      |
| `packages/ingestao/src/casos-de-uso/ftp.ts`                                              | `src/aplicacao/casos-de-uso/ftp.ts`                          |
| `packages/ingestao/src/casos-de-uso/gravar-cte.ts`                                       | `src/aplicacao/casos-de-uso/gravar-cte.ts`                   |
| `packages/ingestao/src/casos-de-uso/index.ts`                                            | `src/aplicacao/casos-de-uso/index.ts`                        |
| `packages/ingestao/src/casos-de-uso/linhas.ts`                                           | `src/aplicacao/casos-de-uso/linhas.ts`                       |
| `apps/api/src/modulos/ingestao/casos-de-uso.ts` (aplicar, FTP, XML da tela)              | `src/aplicacao/casos-de-uso/manuais.ts` (+ `.test.ts`, novo) |
| `apps/api/src/modulos/ingestao/rotas-admin.ts` (rotas das operações manuais)             | `src/http/interno.ts`                                        |
| `apps/migrador/src/passos/projecoes.ts` (commit 94fc9e6, leitura da staging do `public`) | `src/cli/origem-public.ts`                                   |
| `packages/ingestao/src/casos-de-uso/manutencao.ts`                                       | `src/aplicacao/casos-de-uso/manutencao.ts`                   |
| `packages/ingestao/src/casos-de-uso/portas.ts`                                           | `src/aplicacao/casos-de-uso/portas.ts`                       |
| `packages/ingestao/src/casos-de-uso/receber.ts`                                          | `src/aplicacao/casos-de-uso/receber.ts`                      |
| `packages/ingestao/src/casos-de-uso/xml.ts`                                              | `src/aplicacao/casos-de-uso/xml.ts`                          |
| `packages/ingestao/src/aplicacao/aplicacao.test.ts`                                      | `src/aplicacao/regras/aplicacao.test.ts`                     |
| `packages/ingestao/src/aplicacao/candidato.ts`                                           | `src/aplicacao/regras/candidato.ts`                          |
| `packages/ingestao/src/aplicacao/ciclo.ts`                                               | `src/aplicacao/regras/ciclo.ts`                              |
| `packages/ingestao/src/aplicacao/comum.ts`                                               | `src/aplicacao/regras/comum.ts`                              |
| `packages/ingestao/src/aplicacao/estorno.ts`                                             | `src/aplicacao/regras/estorno.ts`                            |
| `packages/ingestao/src/aplicacao/index.ts`                                               | `src/aplicacao/regras/index.ts`                              |
| `packages/ingestao/src/aplicacao/partes-455.ts`                                          | `src/aplicacao/regras/partes-455.ts`                         |
| `packages/ingestao/src/aplicacao/romaneio-036.ts`                                        | `src/aplicacao/regras/romaneio-036.ts`                       |
| `apps/worker/src/config/env.ts`                                                          | `src/config/ambiente.ts`                                     |
| `apps/worker/src/fontes/bi2/bi2.test.ts`                                                 | `src/fontes/bi2/bi2.test.ts`                                 |
| `apps/worker/src/fontes/bi2/cliente.ts`                                                  | `src/fontes/bi2/cliente.ts`                                  |
| `apps/worker/src/fontes/bi2/job.ts`                                                      | `src/fontes/bi2/job.ts`                                      |
| `apps/worker/src/fontes/bi2/relatorio-0017.ts`                                           | `src/fontes/bi2/relatorio-0017.ts`                           |
| `apps/worker/src/fontes/bi2/repositorio.ts`                                              | `src/fontes/bi2/repositorio.ts`                              |
| `apps/worker/src/fontes/comum/empresa.ts`                                                | `src/fontes/comum/empresa.ts`                                |
| `apps/worker/src/fontes/comum/integracao.ts`                                             | `src/fontes/comum/integracao.ts`                             |
| `apps/worker/src/fontes/comum/repositorio-integracoes.ts`                                | `src/fontes/comum/repositorio-integracoes.ts`                |
| `packages/ingestao/src/relatorios/colunas-455.ts`                                        | `src/fontes/relatorios/colunas-455.ts`                       |
| `packages/ingestao/src/relatorios/deteccao.ts`                                           | `src/fontes/relatorios/deteccao.ts`                          |
| `packages/ingestao/src/relatorios/index.ts`                                              | `src/fontes/relatorios/index.ts`                             |
| `packages/ingestao/src/relatorios/partes.ts`                                             | `src/fontes/relatorios/partes.ts`                            |
| `packages/ingestao/src/relatorios/r036.ts`                                               | `src/fontes/relatorios/r036.ts`                              |
| `packages/ingestao/src/relatorios/r038.ts`                                               | `src/fontes/relatorios/r038.ts`                              |
| `packages/ingestao/src/relatorios/r306.ts`                                               | `src/fontes/relatorios/r306.ts`                              |
| `packages/ingestao/src/relatorios/r455csv.ts`                                            | `src/fontes/relatorios/r455csv.ts`                           |
| `packages/ingestao/src/relatorios/r930.ts`                                               | `src/fontes/relatorios/r930.ts`                              |
| `packages/ingestao/src/relatorios/relatorios.test.ts`                                    | `src/fontes/relatorios/relatorios.test.ts`                   |
| `packages/ingestao/src/relatorios/texto.ts`                                              | `src/fontes/relatorios/texto.ts`                             |
| `packages/ingestao/src/relatorios/tipos.ts`                                              | `src/fontes/relatorios/tipos.ts`                             |
| `apps/worker/src/fontes/ssw-api/cliente.ts`                                              | `src/fontes/ssw-api/cliente.ts`                              |
| `apps/worker/src/fontes/ssw-api/cofre-de-token.ts`                                       | `src/fontes/ssw-api/cofre-de-token.ts`                       |
| `apps/worker/src/fontes/ssw-api/job.ts`                                                  | `src/fontes/ssw-api/job.ts`                                  |
| `apps/worker/src/fontes/ssw-api/ssw-api.test.ts`                                         | `src/fontes/ssw-api/ssw-api.test.ts`                         |
| `apps/worker/src/fontes/webhook/job.ts`                                                  | `src/fontes/webhook/job.ts`                                  |
| `apps/api/src/modulos/ingestao-ssw/webhook.ts` (+ `.test.ts`)                            | `src/fontes/webhook/recepcao.ts`                             |
| `apps/worker/src/fontes/webhook/repositorio.ts`                                          | `src/fontes/webhook/repositorio.ts`                          |
| `apps/worker/src/fontes/webhook/webhook.test.ts`                                         | `src/fontes/webhook/webhook.test.ts`                         |
| `packages/ingestao/src/xml-cte/index.ts`                                                 | `src/fontes/xml-cte/index.ts`                                |
| `packages/ingestao/src/xml-cte/leitor.ts`                                                | `src/fontes/xml-cte/leitor.ts`                               |
| `packages/ingestao/src/xml-cte/regras.ts`                                                | `src/fontes/xml-cte/regras.ts`                               |
| `packages/ingestao/src/xml-cte/xml-cte.test.ts`                                          | `src/fontes/xml-cte/xml-cte.test.ts`                         |
| `apps/api/src/infra/log.ts`                                                              | `src/http/log.ts`                                            |
| `apps/api/src/modulos/ingestao/rotas-publicas.ts`                                        | `src/http/publico/ingestao.ts`                               |
| `apps/api/src/modulos/ingestao/repositorio.ts`                                           | `src/http/publico/repositorio.ts`                            |
| `apps/api/src/modulos/ingestao/servicos.ts`                                              | `src/http/publico/servicos.ts`                               |
| `apps/api/src/modulos/ingestao-ssw/rotas-publicas.ts`                                    | `src/http/publico/webhook.ts`                                |
| `packages/ingestao/src/infra/coletas-050.ts`                                             | `src/infra/coletas-050.ts`                                   |
| `apps/api/src/infra/limitador.ts`                                                        | `src/infra/contador.ts`                                      |
| `packages/ingestao/src/infra/credenciais.ts`                                             | `src/infra/credenciais.ts`                                   |
| `packages/ingestao/src/infra/enfileirador.ts` (+ `.test.ts`)                             | `src/infra/enfileirador.ts`                                  |
| `packages/ingestao/src/infra/index.ts`                                                   | `src/infra/index.ts`                                         |
| `packages/ingestao/src/infra/projecoes-romaneio.ts`                                      | `src/infra/projecoes-romaneio.ts`                            |
| `packages/ingestao/src/infra/redis.ts`                                                   | `src/infra/redis.ts`                                         |
| `packages/ingestao/src/infra/repositorio.ts` (+ `.test.ts`)                              | `src/infra/repositorio.ts`                                   |
| `packages/ingestao/src/infra/sftp.ts` (+ `.test.ts`)                                     | `src/infra/sftp.ts`                                          |
| `apps/worker/src/agendamentos/agendamentos.ts`                                           | `src/jobs/agendamentos/agendamentos.ts`                      |
| `apps/worker/src/agendamentos/ingestao.ts` (+ `.test.ts`)                                | `src/jobs/agendamentos/ingestao.ts`                          |
| `apps/worker/src/agendamentos/repositorio.ts`                                            | `src/jobs/agendamentos/repositorio.ts`                       |
| `apps/worker/src/jobs/coletas/job.ts` (+ `.test.ts`)                                     | `src/jobs/coletas/job.ts`                                    |
| `apps/worker/src/jobs/ingestao/jobs.ts`                                                  | `src/jobs/ingestao/jobs.ts`                                  |
| `apps/worker/src/worker.test.ts`                                                         | `src/jobs/jobs.test.ts`                                      |
| `apps/worker/src/jobs/manutencao/job.ts`                                                 | `src/jobs/manutencao/job.ts`                                 |
| `apps/worker/src/jobs/manutencao/repositorio.ts`                                         | `src/jobs/manutencao/repositorio.ts`                         |
| `apps/worker/src/processador.ts`                                                         | `src/jobs/processador.ts`                                    |
| `apps/worker/src/jobs/projecoes-romaneio/job.ts` (+ `.test.ts`)                          | `src/jobs/projecoes-romaneio/job.ts`                         |
| `apps/worker/src/jobs/registro.ts`                                                       | `src/jobs/registro.ts`                                       |
| `apps/worker/src/jobs/sla-arquivos/job.ts` (+ `.test.ts`)                                | `src/jobs/sla-arquivos/job.ts`                               |
| `apps/worker/src/jobs/sla-arquivos/repositorio.ts`                                       | `src/jobs/sla-arquivos/repositorio.ts`                       |
| `apps/worker/src/testes/banco-falso.ts`                                                  | `src/testes/banco-falso.ts`                                  |
| `packages/ingestao/src/testes/cte.ts`                                                    | `src/testes/cte.ts`                                          |
| `packages/ingestao/src/testes/falsos.ts`                                                 | `src/testes/falsos.ts`                                       |
| `packages/ingestao/src/testes/index.ts`                                                  | `src/testes/index.ts`                                        |
| `apps/worker/src/testes/projecoes-falsas.ts`                                             | `src/testes/projecoes-falsas.ts`                             |
| `packages/ingestao/src/testes/registros.ts`                                              | `src/testes/registros.ts`                                    |

**Novos** (sem origem no ERP): `src/http/{app,interno,saude,erros,limite}.ts`,
`src/contrato-interno.ts`, `src/infra/execucoes.ts`, `src/banco/contrato-de-schema.ts`,
`src/fontes/webhook/repositorio-recepcao.ts` (a parte de banco da recepção, que estava na API),
`src/jobs/todos.ts`, `src/cli/reconstruir-projecoes.ts`, `src/main.ts` e `src/testes/http.ts`.
