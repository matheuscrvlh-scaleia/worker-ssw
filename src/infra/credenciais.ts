/**
 * Configuração do SFTP da empresa a partir da integração `sftp` (parâmetros + senha já decifrada
 * pelo cofre do worker). Sem senha no cofre, as variáveis `SFTP_*` só valem com
 * `parametros.usar_env` (transição da FR). Spec 06 §0.1 e §3.1.
 */
import { type ConfiguracaoSftp } from "../aplicacao/casos-de-uso/portas";

/** Variáveis `SFTP_*` do ambiente (só com `usar_env`). */
export interface SftpDoAmbiente {
  SFTP_HOST?: string | undefined;
  SFTP_PORTA?: string | undefined;
  SFTP_USUARIO?: string | undefined;
  SFTP_SENHA?: string | undefined;
  SFTP_IMPRESSAO_DIGITAL?: string | undefined;
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export function montarConfiguracaoSftp(
  integracao: { ativo: boolean; parametros: Record<string, unknown> } | null,
  senhaDoCofre: string | null,
  ambiente: SftpDoAmbiente,
): ConfiguracaoSftp | null {
  if (!integracao?.ativo) return null;
  const p = integracao.parametros;
  const usarEnv = p.usar_env === true || p.usar_env === "true";
  const senha = senhaDoCofre ?? (usarEnv ? texto(ambiente.SFTP_SENHA) : null);
  const host = texto(p.host) ?? (usarEnv ? texto(ambiente.SFTP_HOST) : null);
  const usuario = texto(p.usuario) ?? (usarEnv ? texto(ambiente.SFTP_USUARIO) : null);
  if (!host || !usuario || !senha) return null;
  const porta = Number(p.porta ?? (usarEnv ? ambiente.SFTP_PORTA : undefined) ?? 22);
  return {
    host,
    porta: Number.isInteger(porta) && porta > 0 ? porta : 22,
    usuario,
    senha,
    impressaoDigital:
      texto(p.impressao_digital) ?? (usarEnv ? texto(ambiente.SFTP_IMPRESSAO_DIGITAL) : null),
    relatoriosPath: texto(p.relatorios_path) ?? "/arquivos_import",
    importadosPath: texto(p.importados_path) ?? "/importados",
  };
}
