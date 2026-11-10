import { describe, expect, it } from "vitest";

import { CADASTRO_FR, fato, ocorrencia } from "../testes/romaneio";
import { ctrcDigitado, normNome, normPlaca, sswNum, sswSigla } from "./normalizacao";
import {
  analisarCte,
  casaRecorte,
  type ContextoDaRegra,
  distribuicaoDosNaoFinalizados,
  type FatoCte,
  kpisDoRomaneio,
  motivosDeNaoEntrega,
  totaisDoTopo,
} from "./situacao";

const ctx = (extra: Partial<ContextoDaRegra> = {}): ContextoDaRegra => ({
  cadastro: CADASTRO_FR,
  codigosPrejuizo: [13],
  periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
  campo: "emissao",
  ...extra,
});
const analisar = (c: FatoCte, extra: Partial<ContextoDaRegra> = {}) => ({
  fato: c,
  analise: analisarCte(c, ctx(extra)),
});

describe("normalizações do 036", () => {
  it("placa, nome e número/sigla do CT-e (exemplos da spec)", () => {
    expect(normPlaca("kqk-6i98 ")).toBe("KQK6I98");
    expect(normPlaca("  ")).toBeNull();
    expect(normNome("  joão  da silva ")).toBe("JOÃO DA SILVA");
    expect(sswNum("CAP038984-6")).toBe("38984");
    expect(sswSigla("CAP038984-6")).toBe("CAP");
    expect(sswNum("CAP")).toBeNull();
    expect(ctrcDigitado("CAP038984-6")).toEqual({ sigla: "CAP", numero: "38984" });
    expect(ctrcDigitado(" 038984 ")).toEqual({ sigla: null, numero: "38984" });
  });
});

describe("situação do CT-e (cards)", () => {
  it("efetiva 85 com saída válida está em rota", () => {
    const { analise } = analisar(
      fato({ ocorrEfetivaCodigo: "85", ocorrencias: [ocorrencia(85, "2026-10-27T12:00:00Z")] }),
    );
    expect(analise.emRota).toBe(true);
    expect(analise.saiuCard).toBe(true);
    expect(analise.emRotaAgora).toBe(true);
  });

  it("85 antes da emissão não vale; efetiva 85 só pela foto (sem 85 na tabela) vale", () => {
    const antes = analisar(
      fato({ ocorrEfetivaCodigo: "85", ocorrencias: [ocorrencia(85, "2026-10-25T12:00:00Z")] }),
    );
    expect(antes.analise.emRota).toBe(false);
    expect(analisar(fato({ ocorrEfetivaCodigo: "85" })).analise.emRota).toBe(true);
  });

  it("85 às 22h de Brasília da véspera da emissão não vale (Q11: dia de Brasília)", () => {
    // 2026-10-26T00:30Z = 25/10 21:30 em Brasília.
    const { analise } = analisar(
      fato({ ocorrEfetivaCodigo: "85", ocorrencias: [ocorrencia(85, "2026-10-26T00:30:00Z")] }),
    );
    expect(analise.emRota).toBe(false);
  });

  it("pendência depois da última saída trava; nova saída destrava; empate trava", () => {
    const travado = analisar(
      fato({
        ocorrEfetivaCodigo: "9",
        ocorrencias: [
          ocorrencia(85, "2026-10-27T10:00:00Z"),
          ocorrencia(9, "2026-10-28T10:00:00Z"),
        ],
      }),
    );
    expect(travado.analise.travado).toBe(true);
    const destravado = analisar(
      fato({
        ocorrEfetivaCodigo: "85",
        ocorrencias: [
          ocorrencia(9, "2026-10-28T10:00:00Z"),
          ocorrencia(85, "2026-10-29T10:00:00Z"),
        ],
      }),
    );
    expect(destravado.analise.travado).toBe(false);
    const empate = analisar(
      fato({
        ocorrEfetivaCodigo: "9",
        ocorrencias: [
          ocorrencia(85, "2026-10-28T10:00:00Z"),
          ocorrencia(9, "2026-10-28T10:00:00Z"),
        ],
      }),
    );
    expect(empate.analise.travado).toBe(true);
  });

  it("por saída, Em rota = CTRC − Entregues (exemplo 1.203 / 1.041 em escala)", () => {
    const ctes = [
      ...Array.from({ length: 4 }, () =>
        analisar(fato({ ocorrEfetivaCodigo: "1" }), { campo: "saida" }),
      ),
      analisar(fato({ ocorrEfetivaCodigo: "80" }), { campo: "saida" }),
    ];
    const t = totaisDoTopo(ctes, "todos", CADASTRO_FR, "2026-11-10");
    expect(t.ctes).toBe(5);
    expect(t.entregues).toBe(4);
    expect(t.emRota).toBe(1);
  });

  it("universo romaneados tira os parados; prejuízo e TDE ignoram o universo", () => {
    const parado = analisar(fato({ tde: 10, ocorrEfetivaCodigo: "80" }));
    const entregue = analisar(fato({ ocorrEfetivaCodigo: "1", tde: 20 }));
    const t = totaisDoTopo([parado, entregue], "romaneados", CADASTRO_FR, "2026-11-10");
    expect(t.ctes).toBe(1);
    expect(t.parado).toBe(0);
    expect(t.tdeCtes).toBe(2);
    expect(t.tdeRomaneadoEntregue).toBe(1);
    expect(t.tdeRomaneadoValor).toBe(20);
  });

  it("faixas do Em rota são relativas a hoje, não ao período", () => {
    const comPrev = (dataPrevista: string | null) =>
      analisar(fato({ ocorrEfetivaCodigo: "85", dataPrevista }));
    const t = totaisDoTopo(
      [comPrev("2026-11-09"), comPrev("2026-11-10"), comPrev("2026-11-12"), comPrev(null)],
      "todos",
      CADASTRO_FR,
      "2026-11-10",
    );
    expect([t.emRotaVencida, t.emRotaHoje, t.emRotaFuturo, t.emRotaSemPrev]).toEqual([1, 1, 1, 1]);
  });

  it("motivo principal dos travados conta ocorrências desde a última saída", () => {
    const c = analisar(
      fato({
        ocorrEfetivaCodigo: "9",
        ocorrencias: [
          ocorrencia(9, "2026-10-26T10:00:00Z"),
          ocorrencia(85, "2026-10-27T10:00:00Z"),
          ocorrencia(13, "2026-10-28T10:00:00Z"),
        ],
      }),
    );
    expect(totaisDoTopo([c], "todos", CADASTRO_FR, "2026-11-10").travadoMotivo).toBe("RETORNO");
  });

  it("frete, prejuízo e TDE somados em centavos, sem erro de float", () => {
    // 0.1 + 0.2 em float dá 0.30000000000000004; o banco soma numeric e dá 0.30.
    const entregues = [0.1, 0.2].map((v) =>
      analisar(fato({ valorFrete: v, tde: v, ocorrEfetivaCodigo: "1" })),
    );
    const prejudicados = entregues.map((c) => ({
      ...c,
      analise: { ...c.analise, saiuEntrega: "sim" as const, prejudicado: true },
    }));
    const t = totaisDoTopo(prejudicados, "todos", CADASTRO_FR, "2026-11-10");
    expect([t.frete, t.prejuizoFrete, t.tdeRomaneadoValor]).toEqual([0.3, 0.3, 0.3]);
    expect(kpisDoRomaneio(prejudicados)).toMatchObject({ freteRomaneado: 0.3, fretePerdido: 0.3 });
  });
});

describe("lista segue o card (Q13)", () => {
  it("efetiva não-85 com 0013 = 85: card e lista dizem 'em rota' juntos", () => {
    const c = analisar(fato({ codigo0013: "85" }));
    expect(c.analise.emRota).toBe(true);
    expect(casaRecorte(c.fato, c.analise, "em_rota", "2026-11-10")).toBe(true);
    const t = totaisDoTopo([c], "todos", CADASTRO_FR, "2026-11-10");
    expect(t.emRota).toBe(1);
  });

  it("cada recorte bate com o card correspondente", () => {
    const ctes = [
      analisar(fato({ ocorrEfetivaCodigo: "1" })),
      analisar(fato({ ocorrEfetivaCodigo: "12" })),
      analisar(fato({ ocorrEfetivaCodigo: "85" })),
      analisar(
        fato({ ocorrEfetivaCodigo: "9", ocorrencias: [ocorrencia(9, "2026-10-28T10:00:00Z")] }),
      ),
      analisar(fato({ ocorrEfetivaCodigo: "80" })),
    ];
    const t = totaisDoTopo(ctes, "todos", CADASTRO_FR, "2026-11-10");
    const conta = (r: Parameters<typeof casaRecorte>[2]) =>
      ctes.filter((c) => casaRecorte(c.fato, c.analise, r, "2026-11-10")).length;
    expect(conta("entregues")).toBe(t.entregues);
    expect(conta("em_rota")).toBe(t.emRota);
    expect(conta("devolvido")).toBe(t.baixadoSemEntrega);
    expect(conta("travado")).toBe(t.travado);
    expect(conta("parado")).toBe(t.parado);
    expect([t.entregues, t.emRota, t.baixadoSemEntrega, t.travado, t.parado]).toEqual([
      1, 3, 1, 1, 1,
    ]);
  });
});

describe("prejuízo", () => {
  const com13 = (quando: string, extra: Partial<FatoCte> = {}) =>
    fato({ ocorrEfetivaCodigo: "13", ocorrencias: [ocorrencia(13, quando)], ...extra });

  it("só conta a ocorrência dentro do período (Q14)", () => {
    // Emitido em 28/10, avaria lançada em 03/11: fora do prejuízo de outubro.
    const c = analisar(com13("2026-11-03T12:00:00Z", { dataEmissao: "2026-10-28" }));
    expect(c.analise.prejudicado).toBe(false);
    expect(analisar(com13("2026-10-30T12:00:00Z")).analise.prejudicado).toBe(true);
  });

  it("CT-e que nunca saiu não entra no prejuízo (Q15)", () => {
    const nuncaSaiu = analisar(
      fato({ ocorrencias: [ocorrencia(13, "2026-10-30T12:00:00Z", { quarentena: true })] }),
    );
    expect(nuncaSaiu.analise.saiuEntrega).toBe("quarentena");
    expect(nuncaSaiu.analise.prejudicado).toBe(false);
    const k = kpisDoRomaneio([nuncaSaiu, analisar(com13("2026-10-30T12:00:00Z"))]);
    expect(k).toMatchObject({ total: 2, romaneado: 1, prejudicada: 1, fretePerdido: 100 });
  });

  it("filtro de códigos troca o código do prejuízo", () => {
    const c = analisar(com13("2026-10-30T12:00:00Z"), { codigosPrejuizo: [9] });
    expect(c.analise.prejudicado).toBe(false);
  });
});

describe("distribuição e motivos", () => {
  it("não finalizados pelo código atual, efetiva > 0174 > 0013", () => {
    const linhas = distribuicaoDosNaoFinalizados(
      [
        analisar(fato({ ocorrEfetivaCodigo: "85" })),
        analisar(fato({ codigo0174: "9", codigo0013: "85" })),
        analisar(fato({ ocorrEfetivaCodigo: "1" })),
      ],
      CADASTRO_FR,
    );
    expect(linhas).toEqual([
      { codigo: 9, descricao: "DESTINATARIO AUSENTE", pendencia: true, qtd: 1 },
      { codigo: 85, descricao: "SAIDA PARA ENTREGA", pendencia: false, qtd: 1 },
    ]);
  });

  it("motivos contam CT-e distintos por código de pendência, qualquer data", () => {
    const m = motivosDeNaoEntrega(
      [
        fato({
          ocorrencias: [
            ocorrencia(9, "2026-10-01T10:00:00Z"),
            ocorrencia(9, "2026-10-02T10:00:00Z"),
          ],
        }),
        fato({
          ocorrencias: [
            ocorrencia(13, "2025-01-01T10:00:00Z", { quarentena: true }),
            ocorrencia(9, "2026-10-01T10:00:00Z"),
          ],
        }),
      ],
      CADASTRO_FR,
      12,
    );
    expect(m).toEqual([
      { codigo: "9", descricao: "DESTINATARIO AUSENTE", qtd: 2 },
      { codigo: "13", descricao: "RETORNO", qtd: 1 },
    ]);
  });
});
