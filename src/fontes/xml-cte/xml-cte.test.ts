import { describe, expect, it } from "vitest";

import { cteDeTeste } from "../../testes/cte";
import {
  camposDoXml,
  casaPeloNumeroCte,
  lerCancelamentoXml,
  lerCteXml,
  numeroCteDaChave,
} from "./";

// CT-e fictício (CNPJs e chaves inventados), na estrutura do SSW1329.
const CHAVE = "33261199888777000166570010000550011000550010";
const CHAVE_NFE = "33261011222333000181550010000123451000123450";
const XML_CTE = `<?xml version="1.0"?>
<cteProc><CTe><infCte Id="CTe${CHAVE}">
  <ide><nCT>55001</nCT><dhEmi>2026-11-03T10:00:00-03:00</dhEmi></ide>
  <compl><Entrega><comData><dProg>2026-11-07</dProg></comData></Entrega></compl>
  <rem><CNPJ>11222333000181</CNPJ><xNome>REMETENTE X</xNome></rem>
  <exped><CNPJ>55666777000188</CNPJ><xNome>PARCEIRO Z</xNome></exped>
  <dest><CNPJ>44555666000177</CNPJ><xNome>DESTINO Y</xNome>
    <enderDest><xLgr>RUA A</xLgr><nro>1</nro><xBairro>CENTRO</xBairro><xMun>RIO DE JANEIRO</xMun><CEP>20000000</CEP><UF>RJ</UF></enderDest></dest>
  <vPrest><vTPrest>99.90</vTPrest></vPrest>
  <infCTeNorm>
    <infCarga><infQ><tpMed>PESO REAL</tpMed><qCarga>12.5</qCarga></infQ><infQ><tpMed>UNIDADE</tpMed><qCarga>3</qCarga></infQ></infCarga>
    <infDoc><infNFe><chave>${CHAVE_NFE}</chave></infNFe></infDoc>
  </infCTeNorm>
</infCte></CTe></cteProc>`;
const XML_CAN = `<procEventoCTe><eventoCTe><infEvento><chCTe>${CHAVE}</chCTe><dhEvento>2026-11-04T09:00:00-03:00</dhEvento><detEvento><evCancCTe><xJust>ERRO</xJust></evCancCTe></detEvento></infEvento></eventoCTe></procEventoCTe>`;

describe("leitura do XML", () => {
  it("lê CT-e com parceiro de terceiro, peso, volumes e chave da NF-e", () => {
    const d = lerCteXml(XML_CTE, new Set(["99888777000166"]));
    expect(d).toMatchObject({
      numeroCteFiscal: 55001,
      chaveCte: CHAVE,
      dataEmissao: "2026-11-03",
      dataPrevistaEntrega: "2026-11-07",
      parceiroCnpj: "55666777000188",
      parceiroNome: "PARCEIRO Z",
      peso: 12.5,
      volumes: 3,
      valorFrete: 99.9,
      chaveNfe: CHAVE_NFE,
      cidadeDestino: "RIO DE JANEIRO",
    });
  });

  it("expedidor da própria empresa não é parceiro", () => {
    expect(lerCteXml(XML_CTE, new Set(["55666777000188"])).parceiroCnpj).toBeNull();
  });

  it("lê o cancelamento", () => {
    expect(lerCancelamentoXml(XML_CAN)).toEqual({
      chaveCte: CHAVE,
      dhEvento: "2026-11-04T09:00:00-03:00",
    });
    expect(numeroCteDaChave(CHAVE)).toBe(55001);
  });
});

describe("regras do XML", () => {
  it("casa pelo nCT só com candidato único da filial emitente", () => {
    expect(casaPeloNumeroCte([{ id: "a", cnpjDaFilial: "99888777000166" }], CHAVE)).toBe("a");
    expect(casaPeloNumeroCte([{ id: "a", cnpjDaFilial: "11111111000111" }], CHAVE)).toBeNull();
    expect(
      casaPeloNumeroCte(
        [
          { id: "a", cnpjDaFilial: "99888777000166" },
          { id: "b", cnpjDaFilial: "99888777000166" },
        ],
        CHAVE,
      ),
    ).toBeNull();
  });

  it("sobrescreve chave e origem do prazo; só preenche vazio; grava a chave da NF-e (Q43)", () => {
    const d = lerCteXml(XML_CTE, new Set());
    const campos = camposDoXml(cteDeTeste({ remetente: "JA TINHA" }), d, new Set());
    expect(campos).toMatchObject({
      chave: CHAVE,
      prazoOrigem: "parceiro",
      chaveNfe: CHAVE_NFE,
      dataPrevistaEntrega: "2026-11-07",
      prazoFonte: "xml_dprog",
      peso: "12.500",
    });
    expect(campos.remetente).toBeUndefined();
  });
});
