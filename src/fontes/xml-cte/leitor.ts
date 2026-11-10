/**
 * Leitor do XML de CT-e (SSW1329) e do evento de cancelamento, e extração dos XML de um `.zip`.
 * Spec 06 §3.19.
 * origem: src/features/admin/xml-cte/server/parser.server.ts (sistema atual)
 */
import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

export type TipoXml = "cte" | "can" | "unknown";

export interface DadosDoCteXml {
  /** Número fiscal (ide/nCT): só casa com `numero_cte`; nunca é o número do CTRC do SSW. */
  numeroCteFiscal: number | null;
  chaveCte: string | null;
  dataEmissao: string | null;
  dataPrevistaEntrega: string | null;
  cnpjRemetente: string | null;
  remetente: string | null;
  cnpjDestinatario: string | null;
  destinatario: string | null;
  cepDestinatario: string | null;
  cidadeDestino: string | null;
  ufDestino: string | null;
  bairroDestino: string | null;
  logradouroDestino: string | null;
  numeroEnderecoDestino: string | null;
  complementoDestino: string | null;
  parceiroCnpj: string | null;
  parceiroNome: string | null;
  valorFrete: number | null;
  chaveNfe: string | null;
  peso: number | null;
  volumes: number | null;
}

export interface DadosDoCancelamento {
  chaveCte: string | null;
  dhEvento: string | null;
}

/** Nó do XML como o fast-xml-parser devolve (objeto, texto ou lista). */
type No = Record<string, unknown>;

function no(v: unknown): No {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as No) : {};
}

function lista(v: unknown): No[] {
  if (v == null) return [];
  return (Array.isArray(v) ? v : [v]).map(no);
}

function s(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function n(v: unknown): number | null {
  const t = s(v);
  if (t === null) return null;
  const x = Number(t.replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

function chaveDoId(id: string | null): string | null {
  if (!id) return null;
  const m = /(\d{44})/.exec(id);
  return m?.[1] ?? (id.replace(/\D/g, "").slice(-44) || null);
}

/** Nome `-cte.xml`/`_cte.xml` = CT-e; `-can.xml`/`_can.xml` = cancelamento; senão, pela raiz. */
export function classificarXml(nome: string, xml: string): TipoXml {
  const baixo = nome.toLowerCase();
  if (baixo.endsWith("-cte.xml") || baixo.endsWith("_cte.xml")) return "cte";
  if (baixo.endsWith("-can.xml") || baixo.endsWith("_can.xml")) return "can";
  if (/<procEventoCTe[\s>]/i.test(xml) || /<evCancCTe[\s>]/i.test(xml)) return "can";
  if (/<cteProc[\s>]/i.test(xml) || /<CTe[\s>]/i.test(xml)) return "cte";
  return "unknown";
}

/**
 * Lê o CT-e. `cnpjsProprios`: CNPJs (dígitos) da própria empresa — expedidor com um deles (ou igual
 * ao remetente) não é parceiro.
 */
export function lerCteXml(xml: string, cnpjsProprios: ReadonlySet<string>): DadosDoCteXml {
  const doc = no(parser.parse(xml));
  const proc = no(doc.cteProc);
  const cte = no(proc.CTe ?? doc.CTe ?? proc.cte ?? doc.cte);
  const infCte = no(cte.infCte ?? cte.infCTe);
  if (Object.keys(cte).length === 0) throw new Error("XML CT-e sem elemento CTe");
  if (Object.keys(infCte).length === 0) throw new Error("infCte/infCTe ausente");
  const ide = no(infCte.ide);
  const rem = no(infCte.rem);
  const dest = no(infCte.dest);
  const exped = no(infCte.exped);
  const norm = no(infCte.infCTeNorm);
  const entrega = no(no(infCte.compl).Entrega);
  const comData = no(entrega.comData ?? entrega.semData ?? entrega.noPeriodo);
  const enderDest = no(dest.enderDest);

  const expedCnpj = s(exped.CNPJ) ?? s(exped.CPF);
  const remCnpj = s(rem.CNPJ) ?? s(rem.CPF);
  const expedDigitos = (expedCnpj ?? "").replace(/\D/g, "");
  const parceiroValido =
    expedDigitos !== "" &&
    expedDigitos !== (remCnpj ?? "").replace(/\D/g, "") &&
    !cnpjsProprios.has(expedDigitos);

  let peso: number | null = null;
  let volumes: number | null = null;
  for (const q of lista(no(norm.infCarga).infQ)) {
    const tipo = (s(q.tpMed) ?? "").toUpperCase();
    const valor = n(q.qCarga);
    if (valor === null) continue;
    if (
      peso === null &&
      (tipo.includes("PESO REAL") || tipo === "PESO" || tipo.includes("PESO BASE"))
    ) {
      peso = valor;
    }
    if (volumes === null && (tipo === "UNIDADE" || tipo.includes("VOLUME")))
      volumes = Math.trunc(valor);
  }
  const nCT = n(ide.nCT);
  const dhEmi = s(ide.dhEmi);
  return {
    numeroCteFiscal: nCT === null ? null : Math.trunc(nCT),
    chaveCte: chaveDoId(s(infCte["@_Id"])),
    dataEmissao: dhEmi ? dhEmi.slice(0, 10) : null,
    dataPrevistaEntrega: s(comData.dProg) ?? s(entrega.dProg),
    cnpjRemetente: remCnpj,
    remetente: s(rem.xNome),
    cnpjDestinatario: s(dest.CNPJ) ?? s(dest.CPF),
    destinatario: s(dest.xNome),
    cepDestinatario: s(enderDest.CEP),
    cidadeDestino: s(enderDest.xMun),
    ufDestino: s(enderDest.UF),
    bairroDestino: s(enderDest.xBairro),
    logradouroDestino: s(enderDest.xLgr),
    numeroEnderecoDestino: s(enderDest.nro),
    complementoDestino: s(enderDest.xCpl),
    parceiroCnpj: parceiroValido ? expedCnpj : null,
    parceiroNome: parceiroValido ? s(exped.xNome) : null,
    valorFrete: n(no(infCte.vPrest).vTPrest),
    chaveNfe: s(lista(no(norm.infDoc).infNFe)[0]?.chave),
    peso,
    volumes,
  };
}

export function lerCancelamentoXml(xml: string): DadosDoCancelamento {
  const doc = no(parser.parse(xml));
  const proc = Object.keys(no(doc.procEventoCTe)).length ? no(doc.procEventoCTe) : doc;
  const evento = no(proc.eventoCTe ?? proc.evento ?? doc.eventoCTe);
  const infEvento = no(evento.infEvento ?? proc.infEvento);
  const det = no(infEvento.detEvento);
  const evCanc = no(det.evCancCTe ?? det.evCancCte ?? det);
  return { chaveCte: s(infEvento.chCTe) ?? s(evCanc.chCTe), dhEvento: s(infEvento.dhEvento) };
}

export interface XmlDoArquivo {
  nome: string;
  conteudo: string;
}

/**
 * Um XML de CT-e tem dezenas de KB: acima de 10 MB por arquivo é bomba de zip. O total (256 MB)
 * cabe milhares de XML com folga.
 */
export const LIMITES_DO_ZIP = { porArquivo: 10 * 1024 * 1024, total: 256 * 1024 * 1024 };

/**
 * Todos os `*.xml` de dentro de um `.zip`, com o caminho interno como nome. O tamanho
 * descompactado (`originalSize`, que o fflate usa como teto da saída) é conferido antes de
 * descompactar: arquivo ou total acima do limite recusa o zip inteiro.
 */
export function xmlsDoZip(bytes: Uint8Array, limites = LIMITES_DO_ZIP): XmlDoArquivo[] {
  let total = 0;
  const arquivos = unzipSync(bytes, {
    filter: (f) => {
      if (!/\.xml$/i.test(f.name)) return false;
      if (f.originalSize > limites.porArquivo) {
        throw new Error(`XML ${f.name} grande demais dentro do zip (limite por arquivo).`);
      }
      total += f.originalSize;
      if (total > limites.total) {
        throw new Error("Zip grande demais depois de descompactado (limite do total).");
      }
      return true;
    },
  });
  return Object.entries(arquivos).map(([nome, conteudo]) => ({
    nome,
    conteudo: strFromU8(conteudo),
  }));
}
