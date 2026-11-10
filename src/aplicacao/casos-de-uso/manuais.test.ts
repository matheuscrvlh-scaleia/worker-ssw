import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { CABECALHO_930 } from "../../fontes/relatorios";
import { cteDeTeste, EMPRESA } from "../../testes/cte";
import {
  enfileiradorFalso,
  estadoFalso,
  filaFalsa,
  progressosFalsos,
  repositorioFalso,
  travasFalsas,
} from "../../testes/falsos";
import { travaDoCiclo } from "./ciclo";
import { travaDoFtp } from "./ftp";
import { bytesDoBase64, criarOperacoesManuais } from "./manuais";
import { type ArquivoXmlRegistrado, type OrfaoXml, type Transacional } from "./portas";

// CT-e e cancelamento fictícios (CNPJs e chaves inventados), na estrutura do SSW1329.
const CHAVE = "33261199888777000166570010000550011000550010";
const XML_CTE = `<?xml version="1.0"?>
<cteProc><CTe><infCte Id="CTe${CHAVE}">
  <ide><nCT>55001</nCT><dhEmi>2026-11-03T10:00:00-03:00</dhEmi></ide>
  <rem><CNPJ>11222333000181</CNPJ><xNome>REMETENTE X</xNome></rem>
  <dest><CNPJ>44555666000177</CNPJ><xNome>DESTINO Y</xNome></dest>
</infCte></CTe></cteProc>`;
const XML_CAN = `<procEventoCTe><eventoCTe><infEvento><chCTe>${CHAVE}</chCTe><dhEvento>2026-11-04T09:00:00-03:00</dhEvento><detEvento><evCancCTe><xJust>ERRO</xJust></evCancCTe></detEvento></infEvento></eventoCTe></procEventoCTe>`;
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const textoEm64 = (texto: string) => base64(strToU8(texto));

function montar() {
  const s = estadoFalso();
  const travas = travasFalsas();
  const progressos = progressosFalsos();
  const enfileirador = enfileiradorFalso();
  const xml = {
    arquivos: [] as Omit<ArquivoXmlRegistrado, "id" | "criadoEm">[],
    itens: [] as { sha256Xml: string; status: string; nomeXml: string }[],
    orfaos: [] as Omit<OrfaoXml, "id" | "tentativas">[],
  };
  const repo = {
    ...repositorioFalso(s),
    arquivoXmlPorSha: (sha: string) =>
      Promise.resolve(
        xml.arquivos
          .map((a, i) => ({ ...a, id: String(i), criadoEm: s.agora }))
          .find((a) => a.sha256 === sha) ?? null,
      ),
    registrarArquivoXml: (a: Omit<ArquivoXmlRegistrado, "id" | "criadoEm">) =>
      Promise.resolve(String(xml.arquivos.push(a))),
    itemXmlJaAplicado: (sha: string) =>
      Promise.resolve(xml.itens.some((i) => i.sha256Xml === sha && i.status === "sucesso")),
    registrarItemXml: (i: { sha256Xml: string; status: string; nomeXml: string }) =>
      Promise.resolve(void xml.itens.push(i)),
    ctePorChaveCte: (chave: string) =>
      Promise.resolve(s.ctes.find((c) => c.chave === chave) ?? null),
    ctesPorNumeroCte: () => Promise.resolve([]),
    ctesPorChaveNfe: () => Promise.resolve([]),
    guardarOrfao: (o: Omit<OrfaoXml, "id" | "tentativas">) =>
      Promise.resolve(void xml.orfaos.push(o)),
  };
  const executar: Transacional = (fn) => fn(repo);
  const manuais = criarOperacoesManuais({
    deps: (empresaId) => ({
      empresaId,
      executar,
      fila: filaFalsa(),
      travas,
      enfileirador,
      agora: () => s.agora,
    }),
    progressos,
  });
  return { s, travas, progressos, enfileirador, xml, manuais };
}

describe("bytes do base64", () => {
  it("aceita com e sem o prefixo data:", () => {
    const esperado = [...strToU8("abc")];
    expect([...bytesDoBase64("YWJj")]).toEqual(esperado);
    expect([...bytesDoBase64("data:text/xml;base64,YWJj")]).toEqual(esperado);
  });
});

describe("FTP pela tela", () => {
  it("lê ligado/pausado, trava e progresso; pausa com auditoria; libera a trava à mão", async () => {
    const { s, travas, progressos, manuais } = montar();
    await travas.adquirir(travaDoFtp(EMPRESA), 1000);
    await progressos.gravar(EMPRESA, { fase: "relatorios", totalArquivos: 3 }, s.agora);
    expect(await manuais.lerFtp(EMPRESA)).toMatchObject({
      ativo: true,
      travaAtiva: true,
      agenda: "A cada minuto, exceto :00 e :30 (1-29,31-59 * * * * UTC)",
      progresso: { fase: "relatorios", totalArquivos: 3, heartbeatEm: s.agora.toISOString() },
    });

    await manuais.ativarFtp(EMPRESA, false);
    expect(s.configuracoes.get("ftp_sync_ativo")).toBe("false");
    expect((await manuais.lerFtp(EMPRESA)).ativo).toBe(false);

    await manuais.liberarTravaDoFtp(EMPRESA);
    expect(await manuais.lerFtp(EMPRESA)).toMatchObject({ travaAtiva: false, progresso: null });
    expect(s.auditoria).toEqual(["pausar", "liberar_trava"]);
  });
});

describe("aplicação pela tela", () => {
  it("simular não pega a trava; aplicar de verdade recusa com a automática rodando", async () => {
    const { travas, manuais } = montar();
    await travas.adquirir(travaDoCiclo(EMPRESA), 1000);
    const simulada = await manuais.aplicar(EMPRESA, { simular: true, limite: 10, offset: 0 });
    expect(simulada).toMatchObject({ dryRun: true, processados: 0, temMais: false });
    await expect(
      manuais.aplicar(EMPRESA, { simular: false, limite: 10, offset: 0 }),
    ).rejects.toThrow(/aplicação automática está rodando/);
  });

  it("aplicar de verdade devolve a trava no fim", async () => {
    const { travas, manuais } = montar();
    const r = await manuais.aplicar(EMPRESA, { simular: false, limite: 10, offset: 0 });
    expect(r).toMatchObject({ dryRun: false, temMais: false, romaneio036: 0 });
    expect(travas.ocupadas.size).toBe(0);
  });
});

describe("relatório enviado à mão", () => {
  it("grava o 930 num lote sem ciclo; cabeçalho divergente só com a confirmação", async () => {
    const { s, manuais } = montar();
    const linha = `1;"CAP033214-5";"03/11/26";"1";"55001";"1";"12345";"";"FRT";"CAP";"04/11/26";"10:00";"04/11/26";"10:00";"usuario";"1";"ENTREGA";"";"";"";"";"";"11222333000181";"CLIENTE"`;
    const r = await manuais.importarRelatorio(EMPRESA, {
      relatorio: "930",
      nomeArquivo: "930_manual.csv",
      conteudoBase64: textoEm64([CABECALHO_930.join(";"), linha].join("\r\n")),
      aceitarDivergencia: false,
    });
    expect(r).toMatchObject({ gravados: 1, erros: 0 });
    expect(s.linhas.map((l) => `${l.relatorio}|${l.sigla}|${l.numero}`)).toEqual(["930|CAP|33214"]);
    await expect(
      manuais.importarRelatorio(EMPRESA, {
        relatorio: "930",
        nomeArquivo: null,
        conteudoBase64: textoEm64("COLUNA;OUTRA\n1;2"),
        aceitarDivergencia: false,
      }),
    ).rejects.toThrow();
  });
});

describe("XML enviado à mão", () => {
  it("CT-e sem par vira órfão; com o CT-e no banco o zip aplica; o mesmo zip de novo é duplicado", async () => {
    const { s, xml, manuais } = montar();
    const sozinho = await manuais.importarXml(EMPRESA, {
      nomeArquivo: "cte.xml",
      conteudoBase64: textoEm64(XML_CTE),
    });
    expect(sozinho).toMatchObject({ status: "parcial", orfaos: 1, ctesProcessados: 0 });
    expect(xml.orfaos).toMatchObject([{ tipo: "cte", chaveCte: CHAVE, nomeXml: "cte.xml" }]);

    s.ctes.push(cteDeTeste({ chave: CHAVE }));
    const zip = `data:application/zip;base64,${base64(
      zipSync({ "lote/cte.xml": strToU8(XML_CTE), "lote/can.xml": strToU8(XML_CAN) }),
    )}`;
    const r = await manuais.importarXml(EMPRESA, { nomeArquivo: "lote.zip", conteudoBase64: zip });
    expect(r).toMatchObject({ status: "sucesso", ctesProcessados: 1, cancelamentos: 1, erros: [] });
    expect(s.ctes[0]?.statusAtual).toBe("CANCELADO");
    expect(xml.arquivos.map((a) => `${a.nomeArquivo}|${a.tipo}|${a.status}`)).toEqual([
      "cte.xml|xml|parcial",
      "lote.zip|zip|sucesso",
    ]);
    const deNovo = await manuais.importarXml(EMPRESA, {
      nomeArquivo: "lote.zip",
      conteudoBase64: zip,
    });
    expect(deNovo.status).toBe("duplicado");
  });

  it("recusa o que não é .xml nem .zip; zip corrompido volta erro sem gravar item", async () => {
    const { xml, manuais } = montar();
    await expect(
      manuais.importarXml(EMPRESA, { nomeArquivo: "notas.txt", conteudoBase64: "YWJj" }),
    ).rejects.toThrow(/\.xml ou \.zip/);
    const r = await manuais.importarXml(EMPRESA, {
      nomeArquivo: "quebrado.zip",
      conteudoBase64: "YWJj",
    });
    expect(r.status).toBe("erro");
    expect(r.erros[0]?.erro).toMatch(/Arquivo inválido/);
    expect(xml.itens).toEqual([]);
  });
});
