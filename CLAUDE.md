# CLAUDE.md — worker-ssw

Leia o `README.md` e a `docs/adr/0001-origem.md` (que aponta para a ADR 0012 do ERP) antes de
qualquer coisa. Resumo do que não se negocia:

- A ADR 0012 do ERP é o contrato: rotas públicas com as mesmas URLs e respostas, HTTP interno
  igual ao de `src/contrato-interno.ts`, só os jobs listados lá. Mudou o contrato? ADR no ERP
  primeiro.
- O banco é do ERP: **nunca** criar migration, função, gatilho, view materializada, cron ou
  extensão. Coluna nova usada aqui entra na cópia de `src/banco/schema/` e na lista de GRANTs do
  README.
- `src/domain/`, `src/compartilhado/` e `src/banco/{index,client,errors,secrets}.ts` são
  espelhos do erp-ssw, com os nomes de arquivo de lá (em inglês): não editar aqui; mudar no ERP e
  copiar (imports `@erp/*` ficam como lá). Exceção: o que o ERP apagou ao passar a ingestão para
  cá (ADR 0012) só existe aqui e é deste repositório (ex.: `ingestion/bi2-0017.ts`,
  `ingestion/webhook-ssw.ts`, `manifest/projections.ts`, dias úteis em `core/deadline.ts`). O que existe nos dois tem de ser
  idêntico; `diff -r --strip-trailing-cr` só pode mostrar linhas a mais deste lado.
- Toda rota do HTTP interno exige o token de serviço; rota pública autentica antes de ler o
  corpo. Segredo nunca em código, log ou commit.
- Testes só com falsos (`src/testes/`): nada contra banco, Redis, SFTP, SSW ou rede.
- Português no domínio, logs, erros e comentários. TS strict, sem `any`, sem código morto.
- bun (nunca npm). Antes de commitar: `bunx tsc --noEmit`, `bunx eslint .`,
  `bunx prettier --check .` e `bunx vitest run`.
