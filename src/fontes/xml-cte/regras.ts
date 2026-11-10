/**
 * Regras do XML de CT-e: casamento com o CT-e (nunca pelo número do CTRC), o que o XML grava e o
 * status do arquivo. Spec 06 §3.19; Q43 do dono (portar o upload e gravar a chave da NF-e).
 * origem: src/features/admin/xml-cte/server/importar.server.ts (sistema atual)
 */
import { type CamposDoCte, type CteDaIngestao, paraNumeric } from "../../aplicacao/regras";
import { type DadosDoCteXml } from "./leitor";

/** CNPJ emitente (dígitos 7–20 da chave). */
export function cnpjEmitenteDaChave(chave: string | null): string | null {
  return chave !== null && /^\d{44}$/.test(chave) ? chave.slice(6, 20) : null;
}

/** nCT dentro da chave (dígitos 26–34). */
export function numeroCteDaChave(chave: string): number | null {
  const n = Number(chave.slice(25, 34));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Candidato pelo nCT: só se único e da filial cujo CNPJ é o emitente da chave. */
export function casaPeloNumeroCte(
  candidatos: readonly { id: string; cnpjDaFilial: string | null }[],
  chaveCte: string | null,
): string | null {
  const emitente = cnpjEmitenteDaChave(chaveCte);
  const [unico] = candidatos;
  if (candidatos.length !== 1 || !unico || emitente === null) return null;
  return unico.cnpjDaFilial === emitente ? unico.id : null;
}

type CampoPreenchivel =
  | "dataEmissao"
  | "remetente"
  | "cnpjRemetente"
  | "destinatario"
  | "cnpjDestinatario"
  | "cepDestinatario"
  | "cidadeDestino"
  | "ufDestino"
  | "bairroDestino"
  | "logradouroDestino"
  | "numeroEnderecoDestino"
  | "complementoDestino"
  | "parceiroCnpj"
  | "parceiroNome"
  | "chaveNfe";

const vazio = (v: unknown) => v == null || v === "";

/**
 * Sobrescreve a chave do CT-e e a origem do prazo (`parceiro` com expedidor de terceiro); só
 * preenche o que está vazio. A chave da NF-e passa a ser gravada (Q43 b). Previsão preenchida
 * pelo XML leva a fonte `xml_dprog` (o núcleo guarda a previsão do SSW à parte — Q19).
 */
export function camposDoXml(
  p: CteDaIngestao,
  d: DadosDoCteXml,
  cnpjsProprios: ReadonlySet<string>,
): CamposDoCte {
  const parceiroDigitos = (d.parceiroCnpj ?? "").replace(/\D/g, "");
  const campos: CamposDoCte = {
    prazoOrigem: parceiroDigitos && !cnpjsProprios.has(parceiroDigitos) ? "parceiro" : "proprio",
  };
  if (d.chaveCte !== null) campos.chave = d.chaveCte;
  const preencher: Record<CampoPreenchivel, string | null> = {
    dataEmissao: d.dataEmissao,
    remetente: d.remetente,
    cnpjRemetente: d.cnpjRemetente,
    destinatario: d.destinatario,
    cnpjDestinatario: d.cnpjDestinatario,
    cepDestinatario: d.cepDestinatario,
    cidadeDestino: d.cidadeDestino,
    ufDestino: d.ufDestino,
    bairroDestino: d.bairroDestino,
    logradouroDestino: d.logradouroDestino,
    numeroEnderecoDestino: d.numeroEnderecoDestino,
    complementoDestino: d.complementoDestino,
    parceiroCnpj: d.parceiroCnpj,
    parceiroNome: d.parceiroNome,
    chaveNfe: d.chaveNfe,
  };
  for (const [campo, valor] of Object.entries(preencher) as [CampoPreenchivel, string | null][]) {
    if (vazio(p[campo]) && valor !== null) campos[campo] = valor;
  }
  if (p.peso === null && d.peso !== null) campos.peso = paraNumeric(d.peso, 3);
  if (p.volumes === null && d.volumes !== null) campos.volumes = d.volumes;
  if (p.valorFrete === null && d.valorFrete !== null)
    campos.valorFrete = paraNumeric(d.valorFrete, 2);
  if (p.dataPrevistaEntrega === null && d.dataPrevistaEntrega !== null) {
    campos.dataPrevistaEntrega = d.dataPrevistaEntrega;
    campos.prazoFonte = "xml_dprog";
  }
  return campos;
}
