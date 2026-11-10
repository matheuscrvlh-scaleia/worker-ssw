import { describe, expect, it } from "vitest";

import { linha036 } from "../testes/romaneio";
import {
  type ChaveCte,
  chaveDoCte,
  conferenteDoCte,
  dadosRelatoriosDoCte,
  type LinhasDoCte,
  type ProjecaoDoCte,
  type ProjecoesGravadas,
  recalcularProjecoesDoRomaneio,
  reconstruirProjecoesDoRomaneio,
  type RepositorioProjecoesRomaneio,
  romaneioAtualDoCte,
  saidasDoCte,
  ultimo036,
  viagensDoCte,
} from "./projecoes";

const em = (iso: string) => new Date(iso);

describe("viagens do CT-e (5.1)", () => {
  it("ordena por saída e hora (nula primeiro) e marca primeira/última/próxima", () => {
    const v = viagensDoCte(
      [
        linha036({ romaneio: "B", dataEmissao: "2026-10-28", horaEmissao: "08:00" }),
        linha036({ romaneio: "A", dataEmissao: "2026-10-27", horaEmissao: "09:00" }),
        linha036({ romaneio: "C", dataEmissao: "2026-10-28", horaEmissao: null }),
      ],
      [],
    );
    expect(v.map((x) => [x.romaneio, x.primeira, x.ultima, x.proximaSaida])).toEqual([
      ["A", true, false, "2026-10-28"],
      ["C", false, false, "2026-10-28"],
      ["B", false, true, null],
    ]);
    expect(v[0]).toMatchObject({ placa: "KQK6I98", motoristaNormalizado: "JOAO" });
  });

  it("a última importação cancelada apaga a viagem, mesmo com importação antiga válida", () => {
    const v = viagensDoCte(
      [
        linha036({ romaneio: "A", situacao: "BAIXADO", importadoEm: em("2026-10-27T10:00:00Z") }),
        linha036({ romaneio: "A", situacao: "CANCELADO", importadoEm: em("2026-10-27T11:00:00Z") }),
      ],
      [],
    );
    expect(v).toEqual([]);
  });

  it("viagem sem linha guardada (expirou) continua e entra na ordem", () => {
    const antiga = viagensDoCte([linha036({ romaneio: "VELHO", dataEmissao: "2026-08-01" })], []);
    const v = viagensDoCte([linha036({ romaneio: "NOVO", dataEmissao: "2026-11-10" })], antiga);
    expect(v.map((x) => [x.romaneio, x.primeira, x.ultima])).toEqual([
      ["VELHO", true, false],
      ["NOVO", false, true],
    ]);
  });
});

describe("dias de saída (5.4)", () => {
  it("uma linha não cancelada basta; dia só com canceladas sai; dia expirado fica", () => {
    const dias = saidasDoCte(
      [
        linha036({ dataEmissao: "2026-11-10", situacao: "CANCELADO" }),
        linha036({ dataEmissao: "2026-11-10", romaneio: "R2", situacao: null }),
        linha036({ dataEmissao: "2026-11-09", situacao: "CANCELADO" }),
      ],
      ["2026-11-09", "2026-08-01"],
    );
    expect(dias).toEqual(["2026-08-01", "2026-11-10"]);
  });
});

describe("romaneio atual (5.2/5.3)", () => {
  it("última importação vence; empate: romaneio nulo primeiro, BAIXADO primeiro", () => {
    const quando = em("2026-11-10T12:00:00Z");
    const r = ultimo036([
      linha036({ romaneio: "B", importadoEm: quando, situacao: "ROTA" }),
      linha036({ romaneio: "B", importadoEm: quando, situacao: "BAIXADO" }),
      linha036({ romaneio: "A", importadoEm: em("2026-11-11T12:00:00Z") }),
    ]);
    expect(r?.romaneio).toBe("A");
    const empate = ultimo036([
      linha036({ romaneio: "B", importadoEm: quando, situacao: "ROTA" }),
      linha036({ romaneio: "B", importadoEm: quando, situacao: "BAIXADO" }),
    ]);
    expect(empate?.situacao).toBe("BAIXADO");
  });

  it("data da ocorrência do 036 em horário de SP; hora vazia = 12:00", () => {
    const r = ultimo036([linha036({ dataOcorrCtrc: "2026-11-10", horaOcorrCtrc: null })]);
    expect(r?.dataOcorr).toEqual(new Date("2026-11-10T15:00:00Z"));
  });

  it("036 sem placa cai no 306", () => {
    const r = romaneioAtualDoCte(
      [linha036({ placa: null, motorista: null })],
      [
        {
          ctrcColeta: "CAP38984-6",
          data: "2026-11-10",
          placa: "abc-1234",
          motorista: "ANA",
          importadoEm: em("2026-11-10T10:00:00Z"),
        },
      ],
      null,
    );
    expect(r).toMatchObject({ placa: "ABC1234", motorista: "ANA" });
  });

  it("sem linha nenhuma guardada, nada muda", () => {
    const gravado = romaneioAtualDoCte([linha036()], [], null);
    expect(romaneioAtualDoCte([], [], gravado)).toEqual(gravado);
  });
});

describe("dados dos relatórios (5.5)", () => {
  it("038 mais recente; valor da mercadoria do 038, senão do 455", () => {
    const d = dadosRelatoriosDoCte(
      [
        {
          setor: " S1 ",
          bairro: "",
          endereco: "RUA A",
          cep: null,
          valorMercadoria: null,
          importadoEm: em("2026-11-10T10:00:00Z"),
        },
        {
          setor: "VELHO",
          bairro: null,
          endereco: null,
          cep: null,
          valorMercadoria: 5,
          importadoEm: em("2026-11-09T10:00:00Z"),
        },
      ],
      [{ valorMercadoria: 900, importadoEm: em("2026-11-10T10:00:00Z") }],
      null,
    );
    expect(d).toEqual({
      valorMercadoria: 900,
      valorMercadoria455: 900,
      r038: { setor: "S1", bairro: null, endereco: "RUA A", cep: null, valorMercadoria: null },
    });
  });
});

describe("conferente do CT-e (tela Ocorrências)", () => {
  it("ocorrência mais recente vence; cancelado e sem romaneio ficam de fora; vazio vira nulo", () => {
    const c = conferenteDoCte(
      [
        linha036({ romaneio: "A", conferente: "ANA", dataOcorrCtrc: "2026-11-09" }),
        linha036({ romaneio: "B", conferente: "  ", dataOcorrCtrc: "2026-11-10" }),
        linha036({
          romaneio: "C",
          conferente: "CAIO",
          situacao: "CANCELADO",
          dataOcorrCtrc: "2026-11-11",
        }),
        linha036({ romaneio: null, conferente: "DUDA", dataOcorrCtrc: "2026-11-11" }),
      ],
      null,
    );
    expect(c).toEqual({ conferente: null, romaneio: "B" });
  });

  it("data da ocorrência nula por último; empate: BAIXADO depois de situação nula", () => {
    const linhas = [
      linha036({ romaneio: "A", conferente: "ANA", dataOcorrCtrc: null }),
      linha036({
        romaneio: "B",
        conferente: "BIA",
        dataOcorrCtrc: "2026-11-01",
        situacao: "BAIXADO",
      }),
      linha036({ romaneio: "C", conferente: "CAIO", dataOcorrCtrc: "2026-11-01", situacao: null }),
    ];
    expect(conferenteDoCte(linhas, null)?.romaneio).toBe("C");
  });

  it("sem linha válida guardada, fica o gravado", () => {
    const gravado = { conferente: "ANA", romaneio: "A" };
    expect(conferenteDoCte([linha036({ situacao: "CANCELADO" })], gravado)).toBe(gravado);
  });
});

class RepositorioFalso implements RepositorioProjecoesRomaneio {
  gravacoes: ProjecaoDoCte[][] = [];
  constructor(
    private readonly linhas: Map<string, LinhasDoCte>,
    private readonly chaves: ChaveCte[],
  ) {}
  linhasDosCtes = () => Promise.resolve(this.linhas);
  estado: ProjecoesGravadas = {
    viagens: new Map(),
    saidas: new Map(),
    atuais: new Map(),
    dados: new Map(),
    conferentes: new Map(),
  };
  gravadas = () => Promise.resolve(this.estado);
  gravar = (p: readonly ProjecaoDoCte[]) => {
    this.gravacoes.push([...p]);
    return Promise.resolve();
  };
  chavesComLinhas = (apos: ChaveCte | null, limite: number) => {
    const inicio = apos ? this.chaves.findIndex((c) => chaveDoCte(c) === chaveDoCte(apos)) + 1 : 0;
    return Promise.resolve(this.chaves.slice(inicio, inicio + limite));
  };
}

describe("caso de uso de recálculo", () => {
  const chave = { sigla: "CAP", numero: "38984" };
  const linhas = new Map([
    [chaveDoCte(chave), { l036: [linha036()], l306: [], l038: [], l455: [] }],
  ]);

  it("incremental: grava só o CT-e que mudou, uma vez por chave", async () => {
    const repo = new RepositorioFalso(linhas, []);
    const r = await recalcularProjecoesDoRomaneio(repo, [
      chave,
      chave,
      { sigla: "CAP", numero: "1" },
    ]);
    expect(r).toEqual({ ctes: 2, alterados: 1 });
    expect(repo.gravacoes[0]?.[0]).toMatchObject({ chave, saidas: ["2026-11-10"] });
  });

  it("o que já está gravado (lido do banco em outra ordem de campos) não regrava", async () => {
    const repo = new RepositorioFalso(linhas, []);
    await recalcularProjecoesDoRomaneio(repo, [chave]);
    const p = repo.gravacoes[0]?.[0];
    if (!p?.atual) throw new Error("sem projeção");
    const k = chaveDoCte(chave);
    repo.estado = {
      viagens: new Map([[k, p.viagens]]),
      saidas: new Map([[k, p.saidas]]),
      atuais: new Map([
        [
          k,
          {
            r306: p.atual.r306,
            r036: p.atual.r036,
            motorista: p.atual.motorista,
            placa: p.atual.placa,
          },
        ],
      ]),
      dados: new Map(),
      conferentes: new Map([[k, { conferente: null, romaneio: "R1" }]]),
    };
    expect(await recalcularProjecoesDoRomaneio(repo, [chave])).toEqual({ ctes: 1, alterados: 0 });
  });

  it("completo: percorre todas as chaves em lotes", async () => {
    const chaves = Array.from({ length: 5 }, (_, i) => ({ sigla: "CAP", numero: String(i + 1) }));
    const repo = new RepositorioFalso(new Map(), chaves);
    const lotes: number[] = [];
    const r = await reconstruirProjecoesDoRomaneio(async (fn) => {
      lotes.push(1);
      return fn(repo);
    }, 2);
    expect(r).toEqual({ ctes: 5, alterados: 0 });
    expect(lotes).toHaveLength(3);
  });
});

describe("descarte de ciclo", () => {
  const chave = { sigla: "CAP", numero: "38984" };
  const k = chaveDoCte(chave);

  it("tira o que veio das linhas apagadas e mantém o que as linhas que ficaram sustentam", async () => {
    const ficou = linha036({ romaneio: "R1", dataEmissao: "2026-11-09", conferente: "ANA" });
    const repo = new RepositorioFalso(
      new Map([[k, { l036: [ficou], l306: [], l038: [], l455: [] }]]),
      [],
    );
    await recalcularProjecoesDoRomaneio(repo, [chave]);
    const antes = repo.gravacoes[0]?.[0];
    if (!antes?.atual) throw new Error("sem projeção");
    // Gravado como se o ciclo descartado tivesse trazido o romaneio R2 no dia 10 e o 038.
    repo.estado = {
      viagens: new Map([
        [
          k,
          [
            ...antes.viagens,
            {
              ...(antes.viagens[0] as (typeof antes.viagens)[number]),
              romaneio: "R2",
              dataSaida: "2026-11-10",
            },
          ],
        ],
      ]),
      saidas: new Map([[k, ["2026-11-09", "2026-11-10"]]]),
      atuais: new Map([[k, antes.atual]]),
      dados: new Map([
        [
          k,
          {
            valorMercadoria: 5,
            valorMercadoria455: null,
            r038: { setor: "S", bairro: null, endereco: null, cep: null, valorMercadoria: 5 },
          },
        ],
      ]),
      conferentes: new Map([[k, { conferente: "BIA", romaneio: "R2" }]]),
    };
    const r = await recalcularProjecoesDoRomaneio(
      repo,
      [],
      [{ ...chave, relatorios: ["036", "038"], romaneios: ["R2"], dias: ["2026-11-10"] }],
    );
    expect(r).toEqual({ ctes: 1, alterados: 1 });
    const depois = repo.gravacoes[1]?.[0];
    expect(depois?.viagens.map((v) => v.romaneio)).toEqual(["R1"]);
    expect(depois?.saidas).toEqual(["2026-11-09"]);
    expect(depois?.dados).toBeNull();
    expect(depois?.conferente).toEqual({ conferente: "ANA", romaneio: "R1" });
    expect(depois?.atual?.r036?.romaneio).toBe("R1");
  });
});
