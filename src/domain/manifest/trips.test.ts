import { describe, expect, it } from "vitest";

import { CADASTRO_FR, fato, ocorrencia, viagem } from "../tests/manifest";
import { analisarCte, type FatoCte } from "./status";
import {
  type ContextoPorViagem,
  type CteComViagens,
  ctesPorCarro,
  ocorrenciaNaViagem,
  performanceAjudante,
  performanceCarro,
  performanceMotorista,
  porViagem,
  prejuizo,
  type Viagem,
} from "./trips";

const ctx: ContextoPorViagem = {
  cadastro: CADASTRO_FR,
  codigosPrejuizo: [13],
  periodo: { inicio: "2026-10-01", fim: "2026-10-31" },
};

function item(c: FatoCte, viagens: Viagem[]): CteComViagens {
  return { fato: c, analise: analisarCte(c, { ...ctx, campo: "saida" }), viagens };
}

// CT-e saiu no romaneio A em 27/10 e no B em 28/10.
const A = viagem({
  romaneio: "A",
  dataSaida: "2026-10-27",
  primeira: true,
  ultima: false,
  proximaSaida: "2026-10-28",
});
const B = viagem({
  romaneio: "B",
  dataSaida: "2026-10-28",
  primeira: false,
  ultima: true,
  placa: "ABC1234",
  motorista: "MARIA",
});

describe("ocorrência na viagem (exemplo da spec)", () => {
  const c = fato({ ocorrencias: [ocorrencia(13, "2026-10-27T15:00:00Z")] });
  const d = fato({ ocorrencias: [ocorrencia(13, "2026-10-28T15:00:00Z")] });

  it("13 de 27/10 cai em A; 13 de 28/10 cai em B", () => {
    expect(ocorrenciaNaViagem(c, A, [13], null, "prejuizo", CADASTRO_FR)).toBe(true);
    expect(ocorrenciaNaViagem(c, B, [13], null, "prejuizo", CADASTRO_FR)).toBe(false);
    expect(ocorrenciaNaViagem(d, A, [13], null, "prejuizo", CADASTRO_FR)).toBe(false);
    expect(ocorrenciaNaViagem(d, B, [13], null, "prejuizo", CADASTRO_FR)).toBe(true);
  });

  it("duas viagens no mesmo dia: a primeira nunca recebe ocorrência", () => {
    const x = viagem({
      romaneio: "X",
      dataSaida: "2026-10-28",
      primeira: false,
      ultima: false,
      proximaSaida: "2026-10-28",
    });
    expect(ocorrenciaNaViagem(d, x, [13], null, "prejuizo", CADASTRO_FR)).toBe(false);
  });
});

describe("telas por viagem", () => {
  const entregueComRetorno = fato({
    ocorrEfetivaCodigo: "1",
    ocorrencias: [ocorrencia(85, "2026-10-27T11:00:00Z"), ocorrencia(13, "2026-10-27T15:00:00Z")],
  });
  const itens = [item(entregueComRetorno, [A, B])];

  it("por romaneio: o CT-e conta nas duas viagens, entregue só na última, prejuízo na do dia", () => {
    const linhas = porViagem(itens, ctx, null);
    expect(
      linhas.map((l) => [l.romaneio, l.ctes, l.entregues, l.fretePerdido, l.transferidas]),
    ).toEqual([
      ["A", 1, 0, 100, 1],
      ["B", 1, 1, 0, 0],
    ]);
    expect(porViagem(itens, ctx, "b").map((l) => l.romaneio)).toEqual(["B"]);
  });

  it("performance do motorista: levados, prejudicadas (13) e % (exemplo 709 levados / 2)", () => {
    const levados = Array.from({ length: 709 }, (_, i) =>
      item(
        fato({
          ocorrEfetivaCodigo: "1",
          ocorrencias: i < 2 ? [ocorrencia(13, "2026-10-27T15:00:00Z")] : [],
        }),
        [viagem({ romaneio: `R${i % 7}`, dataSaida: "2026-10-27" })],
      ),
    );
    const [linha] = performanceMotorista(
      levados,
      ctx,
      [{ nome: "João da Silva", equipe: "Equipe 1" }],
      {
        verPlaca: true,
        exigeViagem: false,
      },
    );
    expect(linha).toMatchObject({
      nome: "JOAO DA SILVA",
      romaneados: 709,
      prejudicadas13: 2,
      performance: 99.72,
      viagens: 7,
      placas: "KQK6I98",
      equipe: "Equipe 1",
    });
  });

  it("sem a permissão de placa, a coluna vem nula", () => {
    const [linha] = performanceMotorista(itens, ctx, [], { verPlaca: false, exigeViagem: false });
    expect(linha?.placas).toBeNull();
  });

  it("ajudante: uma linha por posição preenchida, filtro pelo nome aparado", () => {
    const comAjudantes = [
      item(fato({ ocorrEfetivaCodigo: "1" }), [
        viagem({ romaneio: "C", dataSaida: "2026-10-27", ajudante: " pedro ", ajudante2: "PEDRO" }),
      ]),
    ];
    const [linha] = performanceAjudante(comAjudantes, ctx, null, true);
    expect(linha).toMatchObject({ nome: "PEDRO", romaneados: 2, viagens: 1 });
    expect(performanceAjudante(comAjudantes, ctx, ["OUTRO"], true)).toEqual([]);
  });

  it("CT-e sem viagem conta para '—' sem filtro de placa e sai com filtro", () => {
    const semViagem = [item(fato({ ocorrEfetivaCodigo: "1" }), [])];
    expect(performanceCarro(semViagem, ctx, false)).toEqual([
      { motorista: "—", placa: null, romaneados: 1, entregues: 1, prejudicadas: 0 },
    ]);
    expect(performanceCarro(semViagem, ctx, true)).toEqual([]);
    expect(ctesPorCarro(semViagem)).toMatchObject([{ placa: null, ctes: 1 }]);
  });

  it("aba Prejuízo: dia de emissão, hora da 1ª ocorrência e motorista da viagem dela", () => {
    const p = prejuizo(itens, ctx);
    expect(p.porDia).toEqual([{ dia: "2026-10-26", ctes: 1, frete: 100 }]);
    expect(p.porHora).toEqual([{ hora: 12, ctes: 1, frete: 100 }]);
    expect(p.motoristas).toEqual([
      { nome: "JOAO DA SILVA", placa: "KQK6I98", ctes: 1, frete: 100 },
    ]);
    expect(p.cidades[0]).toMatchObject({ nome: "CAMPINAS", ctes: 1 });
  });

  it("frete somado em centavos por romaneio, por carro e no Prejuízo (0,1 + 0,2 = 0,3)", () => {
    const comFrete = [0.1, 0.2].map((valorFrete) =>
      item(
        fato({
          valorFrete,
          ocorrEfetivaCodigo: "1",
          ocorrencias: [
            ocorrencia(85, "2026-10-27T11:00:00Z"),
            ocorrencia(13, "2026-10-27T15:00:00Z"),
          ],
        }),
        [A],
      ),
    );
    expect(porViagem(comFrete, ctx, null)).toMatchObject([
      { romaneio: "A", frete: 0.3, fretePerdido: 0.3 },
    ]);
    expect(ctesPorCarro(comFrete)).toMatchObject([{ frete: 0.3 }]);
    const p = prejuizo(comFrete, ctx);
    expect([p.porDia[0]?.frete, p.porHora[0]?.frete, p.motoristas[0]?.frete]).toEqual([
      0.3, 0.3, 0.3,
    ]);
    expect(p.cidades[0]?.frete).toBe(0.3);
  });
});
