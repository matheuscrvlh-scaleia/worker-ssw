import { registro455Csv } from "@erp/shared/ssw-reports";
import { describe, expect, it } from "vitest";

import {
  CABECALHO_930,
  CABECALHO_LITERAL_036,
  CABECALHO_LITERAL_306,
  detectarPeloNome,
  detectarRelatorio,
  detectarRelatorioBytes,
  dividirCsv,
  ler036,
  ler038,
  ler306,
  ler455Csv,
  ler930,
  nomeParte,
  numCtrc,
  pareceRelatorio050,
  siglaCtrc,
  unidadeDeLocalizacao,
} from ".";

// Amostras anonimizadas (nomes e CNPJs fictícios), no layout real de cada relatório.
const CAB_930 = CABECALHO_930.join(";");
const linha930 = (cod: string, data: string, hora: string, extra = "") =>
  `1;"CAP033214-5";"03/11/26";"1";"55001";"1";"12345";"";"FRT";"CAP";"03/11/26";"10:05";"${data}";"${hora}";"usuario";"${cod}";"ENTREGA REALIZADA";"${extra}";"";"";"";"";"11222333000181";"CLIENTE EXEMPLO LTDA"`;

const CAB_038 =
  "1;CTRC;NOTA FISCAL;REMETENTE;DESTINATARIO;ENDERECO;CIDADE;BAIRRO;CEP;SETOR;VALOR MERCADORIA;QUANTIDADE VOLUMES;PESO;PRAZO ENTREGA;ATRASO;ULTIMA OCORRENCIA;LOCALIZACAO";
const linha038 = (prazo: string) =>
  `2;CAP033214-5;12345;REMETENTE X;DESTINO Y;RUA A 1;RIO DE JANEIRO;CENTRO;20000000;R07;1500.5;3.9;12.25;${prazo};2;85 SAIDA;FRT CAP - EM TRANSITO`;

describe("número e sigla do CTRC", () => {
  it("separa número e sigla como o SQL atual", () => {
    expect(numCtrc("CAP033214-5")).toBe("33214");
    expect(numCtrc("  -  ")).toBeNull();
    expect(numCtrc(null)).toBeNull();
    expect(siglaCtrc("cap1")).toBe("CAP");
    expect(siglaCtrc("123")).toBeNull();
  });

  it("unidade pela localização do 038, sem o domínio", () => {
    expect(unidadeDeLocalizacao("FRT CAP - EM TRANSITO", "FRT")).toBe("CAP");
    expect(unidadeDeLocalizacao("ARA-PATIO", "frt")).toBe("ARA");
    expect(unidadeDeLocalizacao("SEM HIFEN", "FRT")).toBeNull();
  });
});

describe("930", () => {
  it("lê dado, hora de São Paulo sem fuso e ano de 2 dígitos", () => {
    const a = ler930([CAB_930, linha930("1", "04/11/26", "9:07")].join("\r\n"));
    expect(a.cabecalhoDivergente).toBe(false);
    expect(a.registros).toHaveLength(1);
    expect(a.registros[0]?.dados).toMatchObject({
      ctrc: "CAP033214-5",
      emissao_ctrc: "2026-11-03",
      ocorrencia_em: "2026-11-04T09:07:00",
      inclusao_em: "2026-11-03T10:05:00",
      cod_ocor: "1",
    });
  });

  it("linha fora do formato vira erro, nunca é ignorada", () => {
    const a = ler930([CAB_930, "X;lixo", '1;"curta"'].join("\n"));
    expect(a.erros.map((e) => e.motivo)).toEqual([
      'linha não começa com "0;" nem "1;" (prefixo encontrado: "X")',
      "esperado 24 campos, encontrado 2",
    ]);
  });

  it("sem cabeçalho é divergente", () => {
    expect(ler930(linha930("1", "04/11/26", "09:00")).cabecalhoDivergente).toBe(true);
  });
});

describe("038", () => {
  it("prazo 31/12/2050 = sem prazo definido, sem atraso", () => {
    const a = ler038(["0;TITULO", CAB_038, linha038("31/12/2050"), "9"].join("\r\n"));
    expect(a.cabecalhoDivergente).toBe(false);
    expect(a.registros[0]?.dados).toMatchObject({
      sem_prazo_definido: true,
      prazo_entrega: null,
      atraso: null,
      quantidade_volumes: 3,
      valor_mercadoria: 1500.5,
    });
  });

  it("número com vírgula vira nulo (o 038 usa ponto)", () => {
    const a = ler038([CAB_038, linha038("12/11/2026").replace("1500.5", "1500,5")].join("\n"));
    expect(a.registros[0]?.dados.valor_mercadoria).toBeNull();
    expect(a.registros[0]?.dados.prazo_entrega).toBe("2026-11-12");
  });
});

describe("306 e 036", () => {
  it("306: cabeçalho que só difere no espaço também diverge", () => {
    const a = ler306(CABECALHO_LITERAL_306.replace("PLACA;", "PLACA ;"));
    expect(a.cabecalhoDivergente).toBe(true);
  });

  it("306: lê 14 campos e para no 9", () => {
    const dado =
      "ABC1D23;CAP33214-5;03/11/2026;JOAO;REM;RJ/RIO;S1;DEST;RJ/RIO;CAP;R07;05/11/2026;ENTREGUE;1";
    const a = ler306([CABECALHO_LITERAL_306, dado, "9;;;;;;;;;;;;;"].join("\n"));
    expect(a.erros).toEqual([]);
    expect(a.registros[0]?.dados).toMatchObject({ placa: "ABC1D23", data: "2026-11-03" });
  });

  it("036: 47 campos, números brasileiros", () => {
    const campos = Array.from({ length: 46 }, () => "");
    campos[0] = "CAP 12345-6";
    campos[1] = "03/11/2026";
    campos[11] = "CAP033214-5";
    campos[32] = "1.234,56";
    campos[34] = "1.002";
    const a = ler036(
      ["0;ROMANEIOS", `1;${CABECALHO_LITERAL_036}`, `2;${campos.join(";")}`].join("\n"),
    );
    expect(a.cabecalhoDivergente).toBe(false);
    expect(a.registros[0]?.dados).toMatchObject({
      romaneio: "CAP 12345-6",
      data_emissao: "2026-11-03",
      frete_ctrc: 1234.56,
      qtde_vol: 1002,
    });
  });
});

describe("455 CSV", () => {
  it("mapeia por nome (acento e caixa não importam) e informa coluna desconhecida", () => {
    const a = ler455Csv(
      [
        "0;RELATORIO 455",
        '1;"Série/Número CTRC";"Valor da Mercadoria";"Data de Emissao";"Coluna Nova"',
        '2;"CAP033214-5";"1.500,25";"03/11/26";"x"',
      ].join("\r\n"),
    );
    expect(a.cabecalhoDivergente).toBe(false);
    expect(a.registros[0]?.dados.serie_numero_ctrc).toBe("CAP033214-5");
    expect(a.registros[0]?.dados.valor_da_mercadoria).toBe(1500.25);
    expect(a.registros[0]?.dados.data_de_emissao).toBe("2026-11-03");
    expect(a.registros[0]?.dados.valor_do_frete).toBeNull();
    expect(a.cabecalhoDiferencas[0]).toContain("Coluna Nova");
    // A linha guardada é lida pelas projeções do Romaneio com o schema do shared.
    expect(registro455Csv.parse(a.registros[0]?.dados).valor_da_mercadoria).toBe(1500.25);
  });

  it("dado antes do cabeçalho é erro; sem cabeçalho é divergente", () => {
    const a = ler455Csv('2;"CAP1-1"');
    expect(a.erros[0]?.motivo).toContain("antes da linha de cabeçalho");
    expect(a.cabecalhoDivergente).toBe(true);
  });
});

describe("detecção", () => {
  it("nome dá relatório, unidade e ciclo; o código 455 sugere o CSV", () => {
    expect(detectarPeloNome("038_pendentes_ARA_2026-11-10_0930.csv")).toEqual({
      relatorio: "038",
      unidade: "ARA",
      cicloChave: "2026-11-10_0930",
    });
    expect(detectarPeloNome("455_csv_e_2026-10-27_1330.csv").relatorio).toBe("455csv");
    expect(detectarPeloNome("qualquer.csv").relatorio).toBeNull();
  });

  it("o cabeçalho decide quando o nome erra", () => {
    const d = detectarRelatorio(
      "036_romaneios_2026-11-10_0930.csv",
      [CAB_930, linha930("1", "04/11/26", "09:00")].join("\n"),
    );
    expect(d.confirmado?.relatorio).toBe("930");
    expect(d.divergenciaNomeCabecalho).toBe(true);
  });

  it("nenhum leitor aceita: motivo com a evidência dos bytes", () => {
    const d = detectarRelatorioBytes("x.csv", new TextEncoder().encode("lixo"));
    expect(d.confirmado).toBeNull();
    expect(d.motivo).toContain("testado latin-1 e UTF-8");
  });

  it("reconhece o 050 pelo conteúdo", () => {
    expect(pareceRelatorio050("UNIDADE;COLETA;TIPO;X\n")).toBe(true);
    expect(pareceRelatorio050("ssw0157  RELACAO DAS COLETAS  05/11/26 13:30")).toBe(true);
    expect(pareceRelatorio050(CAB_930)).toBe(false);
  });
});

describe("partes de arquivo grande", () => {
  it("repete as linhas 0; e 1; em cada parte e respeita o teto", () => {
    const texto =
      ["0;TIT", "1;A;B", ...Array.from({ length: 10 }, (_, i) => `2;${i};xxxxxxxxxx`)].join("\n") +
      "\n";
    const partes = dividirCsv(new TextEncoder().encode(texto), 60);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) {
      const t = new TextDecoder().decode(p);
      expect(t.startsWith("0;TIT\n1;A;B\n")).toBe(true);
      expect(p.length).toBeLessThanOrEqual(60);
    }
    const dados = partes.flatMap((p) =>
      new TextDecoder()
        .decode(p)
        .split("\n")
        .filter((l) => l.startsWith("2;")),
    );
    expect(dados).toHaveLength(10);
  });

  it("nome da parte mantém o carimbo no fim", () => {
    expect(nomeParte("455_csv_e_2026-10-27_1330.csv", 1)).toBe(
      "455_csv_e_parte01_2026-10-27_1330.csv",
    );
    expect(nomeParte("solto.csv", 12)).toBe("solto_parte12.csv");
  });
});
