/**
 * Escopo de visibilidade de CT-e e ocorrência por unidade/equipe. Q26 do dono: uma regra só,
 * portada **desligada** até existir a tela que grava a unidade/equipe do usuário (hoje ninguém tem
 * escopo, então todos veem tudo da empresa). Por isso nenhuma consulta usa estas funções ainda:
 * quando a tela vier, o repositório aplica o fragmento
 * `($verTudo OR c.unidade_id = $unidade OR c.equipe_id = ANY($equipes))`. O RLS já restringe à
 * empresa.
 */
import { PAPEL_ADMIN, PAPEL_GESTOR, PAPEL_SUPER_ADMIN } from "@erp/shared/access/roles";

export interface EscopoDoUsuario {
  /** Papel do vínculo ativo na empresa ativa. */
  papel: string | null;
  adminPlataforma: boolean;
  /** `empresa_usuarios.unidade_id` na empresa ativa. */
  unidadeId: string | null;
  /** Equipes da empresa ativa de que o usuário é membro sem data de saída. */
  equipesAtivas: readonly string[];
}

const PAPEIS_QUE_VEEM_TUDO: ReadonlySet<string> = new Set([
  PAPEL_ADMIN,
  PAPEL_SUPER_ADMIN,
  PAPEL_GESTOR,
]);

/**
 * Admin, super admin, gestor e admin da Plataforma veem tudo; quem não tem unidade nem equipe
 * também (sem escopo definido).
 * origem: pode_ver_tudo (sistema atual)
 */
export function podeVerTudo(usuario: EscopoDoUsuario): boolean {
  if (usuario.adminPlataforma) return true;
  if (usuario.papel !== null && PAPEIS_QUE_VEEM_TUDO.has(usuario.papel)) return true;
  return usuario.unidadeId === null && usuario.equipesAtivas.length === 0;
}

/** origem: pode_ver_ctrc (sistema atual) */
export function podeVerCte(
  usuario: EscopoDoUsuario,
  cte: { unidadeId: string | null; equipeId: string | null },
): boolean {
  if (podeVerTudo(usuario)) return true;
  if (usuario.unidadeId !== null && usuario.unidadeId === cte.unidadeId) return true;
  return cte.equipeId !== null && usuario.equipesAtivas.includes(cte.equipeId);
}
