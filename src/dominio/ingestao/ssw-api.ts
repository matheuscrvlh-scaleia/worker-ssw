/**
 * Token de sessão da SSW API (`generateToken`): validade, renovação pelo job de hora em hora e a
 * faixa "Integração SSW indisponível" do layout. Especificação: docs/regras/06-ingestao.md §3.18.
 */

/** O SSW não informa a validade: hoje vale 4 h a partir da geração. */
export const TTL_DO_TOKEN_MS = 4 * 60 * 60_000;

/** O job só renova quando faltam 90 min ou menos. */
export const MARGEM_DE_RENOVACAO_MS = 90 * 60_000;

export type MotivoDaSaude = "ok" | "sem_credenciais" | "sem_token" | "token_expirado";

export interface SaudeDaIntegracaoSsw {
  configurado: boolean;
  tokenValido: boolean;
  tokenAtualizadoEm: Date | null;
  saudavel: boolean;
  motivo: MotivoDaSaude;
}

/**
 * Integração desligada (ou sem empresa) é "saudável": a faixa só acende para quem usa a SSW API.
 * origem: getSswHealth (src/features/ssw/ingestao.functions.ts)
 */
export function saudeDaIntegracaoSsw(entrada: {
  ativa: boolean;
  configurado: boolean;
  tokenGeradoEm: Date | null;
  agora: Date;
}): SaudeDaIntegracaoSsw {
  if (!entrada.ativa) {
    return {
      configurado: false,
      tokenValido: false,
      tokenAtualizadoEm: null,
      saudavel: true,
      motivo: "ok",
    };
  }
  const tokenValido =
    entrada.tokenGeradoEm !== null &&
    entrada.agora.getTime() - entrada.tokenGeradoEm.getTime() < TTL_DO_TOKEN_MS;
  let motivo: MotivoDaSaude = "ok";
  if (!entrada.configurado) motivo = "sem_credenciais";
  else if (entrada.tokenGeradoEm === null) motivo = "sem_token";
  else if (!tokenValido) motivo = "token_expirado";
  return {
    configurado: entrada.configurado,
    tokenValido,
    tokenAtualizadoEm: entrada.tokenGeradoEm,
    saudavel: entrada.configurado && tokenValido,
    motivo,
  };
}

/** Tempo até o token vencer; `null` sem token. */
export function tempoRestanteDoToken(geradoEm: Date | null, agora: Date): number | null {
  return geradoEm === null ? null : TTL_DO_TOKEN_MS - (agora.getTime() - geradoEm.getTime());
}

/** O heartbeat deixa o token como está se ainda faltar mais que a margem. */
export function precisaRenovarToken(geradoEm: Date | null, agora: Date): boolean {
  const restante = tempoRestanteDoToken(geradoEm, agora);
  return restante === null || restante <= MARGEM_DE_RENOVACAO_MS;
}

export interface CredenciaisSsw {
  dominio: string;
  usuario: string;
  senha: string;
  cnpjEdi: string;
}

/** Tira acentos (o SSW recusa domínio/usuário acentuados). */
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Normaliza as credenciais para o `generateToken`: domínio maiúsculo e sem acento, usuário sem
 * acento, CNPJ com 14 dígitos. Erro = texto para o operador.
 * origem: obterToken (src/features/ssw/server/ssw-token.server.ts)
 */
export function normalizarCredenciaisSsw(
  credenciais: CredenciaisSsw,
): { tipo: "ok"; credenciais: CredenciaisSsw } | { tipo: "erro"; mensagem: string } {
  const dominio = semAcento(credenciais.dominio.trim()).toUpperCase();
  const usuario = semAcento(credenciais.usuario.trim());
  const cnpjEdi = credenciais.cnpjEdi.replace(/\D/g, "");
  if (!dominio || !usuario || !credenciais.senha) {
    return {
      tipo: "erro",
      mensagem: "Credenciais da SSW API incompletas (domínio, usuário e senha).",
    };
  }
  if (cnpjEdi.length !== 14) {
    return {
      tipo: "erro",
      mensagem: `CNPJ EDI inválido: esperado 14 dígitos, recebido ${cnpjEdi.length}.`,
    };
  }
  return { tipo: "ok", credenciais: { dominio, usuario, senha: credenciais.senha, cnpjEdi } };
}

/** Por que o `generateToken` falhou: indisponibilidade do SSW, sem permissão ou login recusado. */
export type TipoDeFalhaSsw = "upstream_unavailable" | "permission_denied" | "auth_failed";

/**
 * HTTP 5xx, página do Cloudflare ("error code: 5xx"), rede ou tempo esgotado (`status` nulo) =
 * o SSW, não a credencial. origem: isUpstreamUnavailableText (ssw-client.server.ts)
 */
export function ehIndisponibilidadeSsw(status: number | null, texto: string): boolean {
  return status === null || status >= 500 || /error code:\s*5\d\d/i.test(texto);
}

export function tipoDaFalhaSsw(status: number | null, mensagem: string): TipoDeFalhaSsw {
  if (ehIndisponibilidadeSsw(status, mensagem)) return "upstream_unavailable";
  if (/cliente sem acesso/i.test(mensagem)) return "permission_denied";
  return "auth_failed";
}

/** Prévia do token para a tela (nunca o token inteiro). */
export function previaDoToken(token: string): string {
  return token.length <= 8 ? "••••" : `${token.slice(0, 4)}…${token.slice(-4)}`;
}
