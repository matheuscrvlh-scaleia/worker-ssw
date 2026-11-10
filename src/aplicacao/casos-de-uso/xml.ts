/**
 * Importação de XML de CT-e (upload manual da tela) e fila de órfãos. Spec 06 §3.19; Q43 do dono
 * (portar o upload e gravar `chave_nfe`). O ramo FTP do XML e `xml-recuperar-orfaos` não são
 * portados (§9).
 * origem: src/features/admin/xml-cte/server/importar.server.ts + orfaos.server.ts (sistema atual)
 */
import { ErroDeNegocio } from "@erp/dominio/erros";

import {
  camposDoXml,
  casaPeloNumeroCte,
  classificarXml,
  DIAS_DO_ORFAO,
  lerCancelamentoXml,
  lerCteXml,
  numeroCteDaChave,
  type StatusDoArquivoXml,
  statusDoArquivoXml,
  type StatusDoItemXml,
  type TipoXml,
  type XmlDoArquivo,
  xmlsDoZip,
} from "../../fontes/xml-cte";
import { type CteDaIngestao } from "../regras";
import { regravarCte } from "./gravar-cte";
import { sha256 } from "./linhas";
import { type RepositorioIngestao, type Transacional } from "./portas";

export interface ResultadoDoXml {
  arquivo: string;
  status: StatusDoArquivoXml;
  ctesProcessados: number;
  cancelamentos: number;
  orfaos: number;
  pulados: number;
  erros: { nome: string; erro: string }[];
}

const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** CT-e do XML: chave → nCT (candidato único da filial emitente) → chave da NF-e (esqueleto). */
async function casarCte(
  r: RepositorioIngestao,
  d: { chaveCte: string | null; numeroCteFiscal: number | null; chaveNfe: string | null },
): Promise<CteDaIngestao | null> {
  if (d.chaveCte) {
    const porChave = await r.ctePorChaveCte(d.chaveCte);
    if (porChave) return porChave;
  }
  if (d.numeroCteFiscal !== null) {
    const id = casaPeloNumeroCte(await r.ctesPorNumeroCte(d.numeroCteFiscal), d.chaveCte);
    if (id) return r.ctePorId(id);
  }
  if (d.chaveNfe) {
    const ids = await r.ctesPorChaveNfe(d.chaveNfe);
    const [unico] = ids;
    if (ids.length === 1 && unico) return r.ctePorId(unico);
  }
  return null;
}

async function casarCancelamento(r: RepositorioIngestao, chave: string | null) {
  if (!chave) return null;
  const porChave = await r.ctePorChaveCte(chave);
  if (porChave) return porChave;
  const numero = numeroCteDaChave(chave);
  if (numero === null) return null;
  const candidatos = await r.ctesPorNumeroCte(numero);
  const [unico] = candidatos;
  return candidatos.length === 1 && unico ? r.ctePorId(unico.id) : null;
}

/** Aplica um XML; `false` = sem CT-e correspondente (vira órfão). */
async function aplicarXml(
  r: RepositorioIngestao,
  tipo: "cte" | "can",
  xml: string,
  agora: Date,
): Promise<{ casado: boolean; chaveCte: string | null; numeroCte: string | null }> {
  const cad = await r.cadastrosDoNucleo();
  const proprios = new Set(cad.cnpjsProprios);
  if (tipo === "can") {
    const c = lerCancelamentoXml(xml);
    const cte = await casarCancelamento(r, c.chaveCte);
    if (!cte) return { casado: false, chaveCte: c.chaveCte, numeroCte: null };
    // `cancelado_em` = instante do evento (a trava do BI2 lê); `motivo_cancelamento` não tem
    // leitor e não existe no modelo novo (modelo.md, Q50).
    const em = c.dhEvento === null ? null : new Date(c.dhEvento);
    const canceladoEm = em === null || Number.isNaN(em.getTime()) ? null : em;
    const ocorrencias = (await r.ocorrenciasDosCtes([cte.id])).get(cte.id) ?? [];
    await regravarCte(r, cad, cte, { statusAtual: "CANCELADO", canceladoEm }, ocorrencias, agora);
    return { casado: true, chaveCte: c.chaveCte, numeroCte: null };
  }
  const d = lerCteXml(xml, proprios);
  const numeroCte = d.numeroCteFiscal === null ? null : String(d.numeroCteFiscal);
  const cte = await casarCte(r, d);
  if (!cte) return { casado: false, chaveCte: d.chaveCte, numeroCte };
  const campos = camposDoXml(cte, d, proprios);
  if (campos.chave && campos.chave !== cte.chave) {
    const dono = await r.cteDaChave(campos.chave);
    if (dono !== null && dono !== cte.id) delete campos.chave;
  }
  const ocorrencias = (await r.ocorrenciasDosCtes([cte.id])).get(cte.id) ?? [];
  await regravarCte(r, cad, cte, campos, ocorrencias, agora);
  return { casado: true, chaveCte: d.chaveCte, numeroCte };
}

/** Importa um `.xml` ou `.zip` enviado pela tela (um arquivo por chamada, uma transação). */
export async function importarArquivoXml(
  executar: Transacional,
  arquivo: { nome: string; bytes: Uint8Array },
  agora: Date,
): Promise<ResultadoDoXml> {
  const tipoArquivo = /\.zip$/i.test(arquivo.nome) ? "zip" : "xml";
  if (tipoArquivo === "xml" && !/\.xml$/i.test(arquivo.nome)) {
    throw new ErroDeNegocio("ENTRADA_INVALIDA", "Envie arquivos .xml ou .zip.");
  }
  const sha = sha256(arquivo.bytes);
  return executar(async (r) => {
    const anterior = await r.arquivoXmlPorSha(sha);
    const vazio = {
      arquivo: arquivo.nome,
      ctesProcessados: 0,
      cancelamentos: 0,
      orfaos: 0,
      erros: [],
    };
    if (anterior?.status === "sucesso") {
      return { ...vazio, status: "duplicado" as const, pulados: anterior.xmlsPulados };
    }
    let xmls: XmlDoArquivo[] = [];
    let erroGeral: string | null = null;
    try {
      xmls =
        tipoArquivo === "zip"
          ? xmlsDoZip(arquivo.bytes)
          : [{ nome: arquivo.nome, conteudo: new TextDecoder("utf-8").decode(arquivo.bytes) }];
    } catch (e) {
      erroGeral = `Arquivo inválido: ${mensagemDe(e)}`;
    }
    const classificados = xmls
      .map((x) => ({ ...x, tipo: classificarXml(x.nome, x.conteudo) }))
      .sort((a, b) => Number(a.tipo === "can") - Number(b.tipo === "can"));
    const itens: StatusDoItemXml[] = [];
    const res: ResultadoDoXml = { ...vazio, status: "sucesso", pulados: 0, erros: [] };
    for (const x of classificados) {
      const shaXml = sha256(x.conteudo);
      if (await r.itemXmlJaAplicado(shaXml)) {
        itens.push("pulado");
        res.pulados++;
        continue;
      }
      const registrar = (
        status: "sucesso" | "erro" | "orfao",
        tipo: TipoXml,
        chaveCte: string | null,
        numeroCte: string | null,
        erro: string | null,
      ) =>
        r.registrarItemXml({
          arquivoId: null,
          sha256Xml: shaXml,
          nomeXml: x.nome,
          tipo,
          status,
          numeroCte,
          chaveCte,
          erroMensagem: erro,
        });
      if (x.tipo === "unknown") {
        itens.push("erro");
        res.erros.push({ nome: x.nome, erro: "XML não reconhecido (nem CT-e nem cancelamento)" });
        await registrar("erro", "unknown", null, null, "XML não reconhecido");
        continue;
      }
      try {
        const a = await aplicarXml(r, x.tipo, x.conteudo, agora);
        if (a.casado) {
          itens.push("sucesso");
          if (x.tipo === "can") res.cancelamentos++;
          else res.ctesProcessados++;
          await registrar("sucesso", x.tipo, a.chaveCte, a.numeroCte, null);
        } else {
          itens.push("orfao");
          res.orfaos++;
          await r.guardarOrfao(
            {
              sha256Xml: shaXml,
              nomeXml: x.nome,
              tipo: x.tipo,
              chaveCte: a.chaveCte,
              xmlConteudo: x.conteudo,
            },
            new Date(agora.getTime() + DIAS_DO_ORFAO * 86_400_000),
          );
          await registrar("orfao", x.tipo, a.chaveCte, a.numeroCte, null);
        }
      } catch (e) {
        itens.push("erro");
        res.erros.push({ nome: x.nome, erro: mensagemDe(e) });
        await registrar("erro", x.tipo, null, null, mensagemDe(e));
      }
    }
    res.status = statusDoArquivoXml(itens, res.ctesProcessados + res.cancelamentos, erroGeral);
    await r.registrarArquivoXml({
      nomeArquivo: arquivo.nome,
      sha256: sha,
      tipo: tipoArquivo,
      status: res.status,
      erroMensagem:
        erroGeral ??
        (res.erros.length
          ? res.erros
              .map((e) => `${e.nome}: ${e.erro}`)
              .join("; ")
              .slice(0, 4000)
          : null),
      ctesProcessados: res.ctesProcessados,
      cancelamentos: res.cancelamentos,
      xmlsPulados: res.pulados,
    });
    if (erroGeral) res.erros.push({ nome: arquivo.nome, erro: erroGeral });
    return res;
  });
}

export const LIMITE_PADRAO_DOS_ORFAOS = 200;

/** Reprocessa a fila de órfãos: expira os vencidos e tenta os mais antigos. */
export async function reprocessarOrfaos(
  executar: Transacional,
  limite: number,
  agora: Date,
): Promise<{ expirados: number; tentados: number; casados: number }> {
  return executar(async (r) => {
    const expirados = await r.expirarOrfaos(agora);
    const orfaos = await r.orfaosPendentes(limite);
    let casados = 0;
    for (const o of orfaos) {
      try {
        const a = await aplicarXml(r, o.tipo, o.xmlConteudo, agora);
        await r.marcarOrfao(o.id, a.casado, a.casado ? null : "CT-e ainda não chegou", agora);
        if (a.casado) {
          casados++;
          await r.promoverItemXml(o.sha256Xml);
        }
      } catch (e) {
        await r.marcarOrfao(o.id, false, mensagemDe(e), agora);
      }
    }
    return { expirados, tentados: orfaos.length, casados };
  });
}
