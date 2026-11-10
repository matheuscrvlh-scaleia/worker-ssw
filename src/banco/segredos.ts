import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Segredos de integração (senha de SFTP, token do SSW…) cifrados pela aplicação com AES-256-GCM.
 * A chave mestra vem do ambiente e tem versão: gravar sempre com a atual, ler com a da linha.
 * Rotação = acrescentar a chave nova, trocar a atual e recifrar as linhas antigas por job.
 */
const ALGORITMO = "aes-256-gcm";
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

export interface ChavesDeSegredo {
  atual: number;
  porVersao: ReadonlyMap<number, Buffer>;
}

/** `"1:<base64 de 32 bytes>,2:<…>"` + versão atual → chaves validadas (falha no boot se errado). */
export function lerChavesDeSegredo(texto: string, atual: number): ChavesDeSegredo {
  const porVersao = new Map<number, Buffer>();
  for (const item of texto
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [versaoTexto, base64] = item.split(":");
    const versao = Number(versaoTexto);
    const chave = Buffer.from(base64 ?? "", "base64");
    if (!Number.isInteger(versao) || versao <= 0 || chave.length !== 32) {
      throw new Error("Chave de segredo inválida: use versão:base64 de 32 bytes.");
    }
    porVersao.set(versao, chave);
  }
  if (!porVersao.has(atual)) throw new Error(`Chave de segredo atual (${atual}) não informada.`);
  return { atual, porVersao };
}

export interface SegredoCifrado {
  cifrado: string;
  versaoChave: number;
}

/**
 * `contexto` (ex.: `empresaId:tipo`) entra como dado autenticado: o segredo de uma integração
 * não decifra se for copiado para a linha de outra.
 */
export function cifrarSegredo(
  chaves: ChavesDeSegredo,
  textoPuro: string,
  contexto: string,
): SegredoCifrado {
  const chave = chaves.porVersao.get(chaves.atual);
  if (!chave) throw new Error("Chave de segredo atual ausente.");
  const iv = randomBytes(TAMANHO_IV);
  const cifra = createCipheriv(ALGORITMO, chave, iv);
  cifra.setAAD(Buffer.from(contexto, "utf8"));
  const corpo = Buffer.concat([cifra.update(textoPuro, "utf8"), cifra.final()]);
  return {
    cifrado: Buffer.concat([iv, cifra.getAuthTag(), corpo]).toString("base64"),
    versaoChave: chaves.atual,
  };
}

export function decifrarSegredo(
  chaves: ChavesDeSegredo,
  segredo: SegredoCifrado,
  contexto: string,
): string {
  const chave = chaves.porVersao.get(segredo.versaoChave);
  if (!chave) throw new Error(`Chave de segredo versão ${segredo.versaoChave} não configurada.`);
  const bruto = Buffer.from(segredo.cifrado, "base64");
  const decifra = createDecipheriv(ALGORITMO, chave, bruto.subarray(0, TAMANHO_IV));
  decifra.setAAD(Buffer.from(contexto, "utf8"));
  decifra.setAuthTag(bruto.subarray(TAMANHO_IV, TAMANHO_IV + TAMANHO_TAG));
  return Buffer.concat([
    decifra.update(bruto.subarray(TAMANHO_IV + TAMANHO_TAG)),
    decifra.final(),
  ]).toString("utf8");
}

/** Dado autenticado do segredo de uma integração (o par empresa + tipo da linha). */
export function contextoDoSegredo(empresaId: string, tipo: string): string {
  return `${empresaId}:${tipo}`;
}
