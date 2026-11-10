/**
 * Papéis (cargos) e setores. O catálogo de cargos é global e editado só pela Plataforma; a
 * chave é texto livre (cargo novo não exige deploy), mas estes têm regra própria no código.
 * origem: src/lib/permissions.ts e tabela `roles` (sistema atual)
 */
export const PAPEL_SUPER_ADMIN = "super_admin";
export const PAPEL_ADMIN = "admin";
export const PAPEL_GESTOR = "gestor";

/** Admin da empresa: pode administrar cadastros e ver os Logs da empresa. */
export function ehAdminDaEmpresa(papel: string | null): boolean {
  return papel === PAPEL_ADMIN || papel === PAPEL_SUPER_ADMIN;
}

export const SETORES = ["diretoria", "monitoramento", "expedicao", "agendamento", "rh"] as const;

export type Setor = (typeof SETORES)[number];

export const ROTULO_DO_SETOR: Record<Setor, string> = {
  diretoria: "Diretoria",
  monitoramento: "Monitoramento",
  expedicao: "Expedição",
  agendamento: "Agendamento",
  rh: "RH",
};
