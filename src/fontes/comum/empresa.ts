/** Repositório de dado de empresa só funciona em job com empresa no contexto (RLS). */
export function exigirEmpresa(empresaId: string | null): string {
  if (empresaId === null) throw new Error("Repositório de empresa usado sem empresa no contexto.");
  return empresaId;
}
