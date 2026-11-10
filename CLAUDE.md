# CLAUDE.md — worker-ssw

Leia o `README.md` e a `docs/adr/0001-origem.md` (que aponta para a ADR 0012 do ERP) antes de
qualquer coisa. Resumo do que não se negocia:

- A ADR 0012 do ERP é o contrato: rotas públicas com as mesmas URLs e respostas, HTTP interno
  igual ao de `src/contrato-interno.ts`, só os jobs listados lá. Mudou o contrato? ADR no ERP
  primeiro.
- O banco é do ERP: **nunca** criar migration, função, gatilho, view materializada, cron ou
  extensão. Coluna nova usada aqui entra na cópia de `src/banco/schema/` e na lista de GRANTs do
  README.
- `src/dominio/`, `src/compartilhado/` e `src/banco/{index,cliente,erros,segredos}.ts` são
  espelhos do erp-ssw: não editar aqui; mudar no ERP e copiar (imports `@erp/*` ficam como lá).
- Toda rota do HTTP interno exige o token de serviço; rota pública autentica antes de ler o
  corpo. Segredo nunca em código, log ou commit.
- Testes só com falsos (`src/testes/`): nada contra banco, Redis, SFTP, SSW ou rede.
- Português no domínio, logs, erros e comentários. TS strict, sem `any`, sem código morto.
- bun (nunca npm). Antes de commitar: `bunx tsc --noEmit`, `bunx eslint .`,
  `bunx prettier --check .` e `bunx vitest run`.
