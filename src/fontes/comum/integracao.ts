/**
 * Integração da empresa (`empresa_integracoes`): ligada ou não, parâmetros e o segredo cifrado.
 * O segredo só é decifrado no job que vai usá-lo e nunca vai para o log.
 */
import {
  type ChavesDeSegredo,
  contextoDoSegredo,
  decifrarSegredo,
  type SegredoCifrado,
} from "@erp/db/secrets";
import { type IntegracaoDaIngestao } from "@erp/shared/ingestion";

export interface IntegracaoGravada {
  ativo: boolean;
  parametros: Record<string, unknown>;
  segredo: SegredoCifrado | null;
  /** `empresas.dominio_ssw` (vale quando a integração não traz `parametros.dominio`). */
  dominioSswDaEmpresa: string | null;
}

export interface VerificacaoDaIntegracao {
  em: Date;
  ok: boolean;
  mensagem: string;
}

export interface RepositorioIntegracoes {
  ler(empresaId: string, tipo: IntegracaoDaIngestao): Promise<IntegracaoGravada | null>;
  /** Última verificação (`ultimo_teste_*`), mostrada em Admin › Ingestão SSW. */
  registrarVerificacao(
    empresaId: string,
    tipo: IntegracaoDaIngestao,
    verificacao: VerificacaoDaIntegracao,
  ): Promise<void>;
}

/** Decifra segredos de integração; sem chaves no ambiente, nenhum segredo está disponível. */
export interface Cofre {
  decifrar(empresaId: string, tipo: IntegracaoDaIngestao, segredo: SegredoCifrado): string | null;
}

export function criarCofre(chaves: ChavesDeSegredo | null): Cofre {
  return {
    decifrar: (empresaId, tipo, segredo) =>
      chaves === null ? null : decifrarSegredo(chaves, segredo, contextoDoSegredo(empresaId, tipo)),
  };
}

/** Parâmetro de texto da integração (vazio quando ausente ou de outro tipo). */
export function parametroTexto(parametros: Record<string, unknown>, chave: string): string {
  const valor = parametros[chave];
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number") return String(valor);
  return "";
}

/** Segredo decifrado da integração, ou `null` (sem segredo gravado ou sem chave no ambiente). */
export function segredoDa(
  cofre: Cofre,
  empresaId: string,
  tipo: IntegracaoDaIngestao,
  integracao: IntegracaoGravada,
): string | null {
  if (integracao.segredo === null) return null;
  const texto = cofre.decifrar(empresaId, tipo, integracao.segredo);
  return texto === null || texto.trim() === "" ? null : texto;
}
