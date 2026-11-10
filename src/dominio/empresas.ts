import { type StatusEmpresa } from "@erp/shared/plataforma";

/**
 * Status em que a empresa está em operação: dá acesso às telas, integra com o Ahgora e roda a
 * ingestão (rotas públicas e jobs agendados). Suspensa e encerrada ficam de fora.
 * origem: status in ('ativa','implantacao') de resolverEmpresaIngestao (sistema atual)
 */
export const STATUS_EM_OPERACAO = [
  "ativa",
  "implantacao",
] as const satisfies readonly StatusEmpresa[];

export function empresaEmOperacao(status: string): boolean {
  return (STATUS_EM_OPERACAO as readonly string[]).includes(status);
}
