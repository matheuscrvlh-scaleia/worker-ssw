import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  calcularPainelDeColetas,
  casaBusca,
  type ColetaDaTela,
  etapaDaSituacao,
  listarColetas,
  statusDoPrazo,
} from "./coletas";
import { planejarGravacao050 } from "./gravacao-050";
import { type Coleta050, lerRelatorio050, pareceRelatorio050 } from "./leitor-050";

const FUSO = "America/Sao_Paulo";
const fixture = (nome: string) => readFileSync(join(__dirname, "__fixtures__", nome), "latin1");

/** Prazo como a tela calcula, a partir do que o leitor devolve. */
function prazo(c: Coleta050, agora = new Date("2026-11-10T12:00:00Z")) {
  const data = (iso: string | null) => (iso ? new Date(iso) : null);
  return statusDoPrazo(
    {
      situacao: c.situacao,
      limiteEm: data(c.limiteEm),
      coletadaEm: data(c.coletadaEm),
      situacaoEm: data(c.situacaoEm),
    },
    agora,
    FUSO,
  );
}

// Blocos reais do 050 (ARA e CAP, out/2026) com nomes, CNPJ, CPF, placas e usuários trocados.
describe("leitor do 050 impresso", () => {
  const amostra = fixture("relatorio-050-amostra.txt");
  const r = lerRelatorio050(amostra);
  const por = (u: string, n: number) => r.coletas.find((c) => c.unidade === u && c.numero === n)!;

  it("lê cabeçalho, períodos e todas as coletas, inclusive depois da quebra de página", () => {
    expect(pareceRelatorio050(amostra)).toBe(true);
    expect(r.emitidoEm).toBe("2026-11-03T15:01:00.000Z");
    expect(r.periodoCadastro).toEqual({ inicio: "2026-10-01", fim: "2026-10-31" });
    expect(r.periodoColeta).toEqual({ inicio: "2026-10-01", fim: "2026-10-31" });
    expect(r.coletas.map((c) => `${c.unidade} ${c.numero}`)).toEqual([
      "ARA 56168",
      "CAP 12532",
      "ARA 56205",
      "ARA 56192",
    ]);
    expect(r.avisos).toEqual([]);
  });

  it("extrai os campos com o ano da emissão e o fuso de São Paulo", () => {
    expect(por("ARA", 56168)).toMatchObject({
      tipo: "NORMAL",
      remetenteCnpj: "11111111000191",
      remetenteNome: "EMPRESA TESTE 1 LTDA",
      remetenteCidade: "JAPERI",
      setor: "264",
      destinoCidade: "GUARULHOS-SP",
      solicitante: "PAJUCARA",
      placa: "ABC1D23",
      situacao: "COLETADA",
      limiteEm: "2026-10-16T23:59:00-03:00",
      limiteInicial: "2026-10-16",
      cadastradaEm: "2026-10-15T10:50:00-03:00",
      diaCadastro: "2026-10-15",
      comandadaEm: "2026-10-16T03:24:00-03:00",
      coletadaEm: "2026-10-16T09:40:00-03:00",
      canceladaEm: null,
      valorMercadoria: 2000,
      volumes: 90,
      pesoKg: 450,
      tipoFrete: "CIF",
      romaneio: "ARA 021749-2",
      cteSigla: null,
    });
    expect(por("ARA", 56168).historico[0]).toMatchObject({
      em: "2026-10-16T09:41:00-03:00",
      unidade: "ARA",
    });
  });

  it("CT-e gerado pela coleta, reversa e CEP colado no bairro", () => {
    expect(por("CAP", 12532)).toMatchObject({ cteSigla: "CAS", cteNumero: "150354" });
    expect(por("ARA", 56192).tipo).toBe("REVERSA");
    expect(por("ARA", 56205).remetenteCidade).toBe("ITABORAI");
  });

  it("no prazo / atrasada bate com o quadro RESUMO do próprio SSW", () => {
    const n = { no_prazo: 0, atrasada: 0, cancelada: 0 };
    for (const c of r.coletas) {
      const s = prazo(c);
      if (s === "no_prazo" || s === "atrasada" || s === "cancelada") n[s]++;
    }
    expect(r.resumo).toMatchObject({ quantidade: 4, coletadas: 3, canceladas: 1 });
    expect(n.no_prazo).toBe(r.resumo!.noPrazo);
    expect(n.atrasada).toBe(r.resumo!.atrasadas);
    // Cancelada depois de coletada continua cancelada.
    expect(prazo(por("ARA", 56205))).toBe("cancelada");
    expect(prazo(por("ARA", 56168))).toBe("no_prazo");
  });

  it("recusa arquivo que não é o 050", () => {
    expect(pareceRelatorio050("Serie;Numero;Data\n1;2;3")).toBe(false);
    expect(() => lerRelatorio050("Serie;Numero;Data\n1;2;3")).toThrow(/não é o relatório 050/);
  });

  it("dezembro em relatório de janeiro fica no ano anterior", () => {
    const texto = amostra
      .replace(/03\/11\/26 12:01/, "05/01/27 08:00")
      .replace(/16\/10 23:59/, "30/12 23:59");
    expect(lerRelatorio050(texto).coletas[0]!.limiteEm).toBe("2026-12-30T23:59:00-03:00");
  });
});

describe("leitor do 050 em CSV (FTP)", () => {
  const csv = fixture("relatorio-050-amostra.csv");
  const r = lerRelatorio050(csv, "050_coletas_2026-11-05_1330.csv");

  it("emissão pelo nome do arquivo e período pelo cadastro", () => {
    expect(pareceRelatorio050(csv)).toBe(true);
    expect(r.emitidoEm).toBe("2026-11-05T16:30:00.000Z");
    expect(r.avisos).toEqual([]);
    expect(r.coletas).toHaveLength(2);
    expect(r.periodoCadastro).toEqual({ inicio: "2026-10-15", fim: "2026-11-04" });
  });

  it("colunas, datas com ano, histórico e derivados", () => {
    const [c, reversa] = r.coletas;
    expect(c).toMatchObject({
      unidade: "ARA",
      numero: 56168,
      placa: "AAA1A11",
      coletadaEm: "2026-10-17T09:40:00-03:00",
      observacao: "1 PALLET CLIENTE ATE AS 17H",
      cteSigla: "ARS",
      cteNumero: "536937",
      romaneio: "ARA 021749-2",
      prejudicadaHorario: true,
    });
    expect(c!.historico[0]).toEqual({
      em: "2026-10-17T09:41:00-03:00",
      unidade: "ARA",
      usuario: "usuario1",
      texto: "CTRC GERADO: ARS 536937-1",
    });
    expect(prazo(c!)).toBe("atrasada");
    expect(reversa).toMatchObject({ tipo: "REVERSA", situacao: "COMANDADA", placa: null });
  });

  it("coluna obrigatória faltando vira mensagem para o operador", () => {
    expect(() => lerRelatorio050("UNIDADE;COLETA;TIPO;X\nARA;1;NORMAL;1")).toThrow(
      "O CSV do 050 veio sem a coluna DATA_LIMITE_INICIAL.",
    );
  });
});

describe("prazo e etapa", () => {
  const agora = new Date("2026-11-10T12:00:00Z");
  const base = { situacao: "CADASTRADA", limiteEm: null, coletadaEm: null, situacaoEm: null };

  it("etapa pela situação", () => {
    expect(["CANCELADA", "COLETADA", "COMANDADA", "CADASTRADA", null].map(etapaDaSituacao)).toEqual(
      ["cancelada", "coletada", "comandada", "cadastrada", "cadastrada"],
    );
  });

  it("aberta: vencida, vence hoje (dia de São Paulo) ou a vencer", () => {
    const limite = (iso: string) => ({ ...base, limiteEm: new Date(iso) });
    expect(statusDoPrazo(limite("2026-11-10T11:00:00Z"), agora, FUSO)).toBe("vencida");
    expect(statusDoPrazo(limite("2026-11-11T02:59:00Z"), agora, FUSO)).toBe("vence_hoje");
    expect(statusDoPrazo(limite("2026-11-11T03:00:00Z"), agora, FUSO)).toBe("a_vencer");
    expect(statusDoPrazo(base, agora, FUSO)).toBe("a_vencer");
  });

  it("coletada sem hora de coleta é atrasada; sem limite é no prazo", () => {
    const coletada = { ...base, situacao: "COLETADA" };
    expect(statusDoPrazo({ ...coletada, limiteEm: agora }, agora, FUSO)).toBe("atrasada");
    expect(statusDoPrazo(coletada, agora, FUSO)).toBe("no_prazo");
  });
});

function coleta(c: Partial<ColetaDaTela> & { numero: number }): ColetaDaTela {
  return {
    unidade: "ARA",
    tipo: "NORMAL",
    etapa: "coletada",
    statusPrazo: "no_prazo",
    diaCadastro: "2026-11-01",
    cadastradaEm: new Date("2026-11-01T10:00:00Z"),
    limiteEm: null,
    solicitante: "PAJUCARA",
    remetenteNome: null,
    destinatarioNome: null,
    notasFiscais: null,
    observacao: null,
    placa: null,
    cteSigla: null,
    cteNumero: null,
    cteTipoDocumento: null,
    prejudicadaHorario: false,
    ...c,
  };
}

describe("painel e lista de coletas", () => {
  const coletas = [
    coleta({ numero: 1, cteSigla: "ARS", cteNumero: "10", cteTipoDocumento: "NORMAL" }),
    coleta({ numero: 2, statusPrazo: "atrasada", tipo: "REVERSA" }),
    coleta({
      numero: 3,
      etapa: "comandada",
      statusPrazo: "vencida",
      limiteEm: new Date("2026-11-09T12:00:00Z"),
      unidade: "CAP",
      solicitante: null,
    }),
    coleta({
      numero: 4,
      etapa: "cadastrada",
      statusPrazo: "a_vencer",
      limiteEm: new Date("2026-11-12T12:00:00Z"),
      placa: "ABC1D23",
      observacao: "Pallet 7% maior",
    }),
    coleta({ numero: 5, etapa: "cancelada", statusPrazo: "cancelada", prejudicadaHorario: true }),
  ];

  it("totais e agrupamentos", () => {
    const p = calcularPainelDeColetas(coletas);
    expect(p.totais).toMatchObject({
      total: 5,
      coletadas: 2,
      noPrazo: 1,
      atrasadas: 1,
      abertas: 2,
      cadastradas: 1,
      comandadas: 1,
      vencidas: 1,
      aVencer: 1,
      canceladas: 1,
      comCtrc: 1,
      prejudicadas: 1,
      reversas: 1,
    });
    expect(p.porUnidade.map((u) => [u.unidade, u.total])).toEqual([
      ["ARA", 4],
      ["CAP", 1],
    ]);
    expect(p.porSolicitante.map((s) => s.solicitante)).toEqual(["PAJUCARA", ""]);
    expect(p.porTipoCtrc).toEqual([{ tipoDocumento: "NORMAL", coletas: 1, ctes: 1 }]);
  });

  it("abertas primeiro, pelo limite; busca literal por placa, número e texto", () => {
    const r = listarColetas(coletas, { status: "todas", busca: "", pagina: 1, tamanho: 50 });
    expect(r.linhas.map((c) => c.numero)).toEqual([3, 4, 1, 2, 5]);
    const achar = (busca: string) =>
      coletas.filter((c) => casaBusca(c, busca)).map((c) => c.numero);
    expect(achar("abc1d23")).toEqual([4]);
    expect(achar("0003")).toEqual([3]);
    expect(achar("7%")).toEqual([4]);
    expect(achar("1_%")).toEqual([]);
    expect(achar("pallet")).toEqual([4]);
    expect(achar("10")).toEqual([1]);
  });
});

describe("gravação do 050", () => {
  const r = lerRelatorio050(fixture("relatorio-050-amostra.txt"));
  const emitido = new Date(r.emitidoEm);

  it("repetida no arquivo: vale a última; mais novo já gravado vence; CT-e e prejudicada grudam", () => {
    const duplicada = { ...r.coletas[0]!, situacao: "CANCELADA" };
    const relatorio = { ...r, coletas: [...r.coletas, duplicada] };
    const jaGravadas = new Map([
      [
        "CAP|12532",
        {
          unidade: "CAP",
          numero: 12532,
          relatorioEmitidoEm: new Date(emitido.getTime() + 1000),
          prejudicadaHorario: false,
          cteSigla: null,
          cteNumero: null,
          romaneio: null,
        },
      ],
      [
        "ARA|56205",
        {
          unidade: "ARA",
          numero: 56205,
          relatorioEmitidoEm: emitido,
          prejudicadaHorario: true,
          cteSigla: "ARS",
          cteNumero: "99",
          romaneio: null,
        },
      ],
    ]);
    const plano = planejarGravacao050(relatorio, "050.txt", jaGravadas);
    expect(plano.lidas).toBe(5);
    expect(plano.ignoradas).toBe(2);
    const por = (n: number) => plano.gravar.find((c) => c.numero === n)!;
    expect(por(56168)).toMatchObject({ situacao: "CANCELADA", etapa: "cancelada" });
    expect(por(56205)).toMatchObject({ prejudicadaHorario: true, cteNumero: "99" });
    expect(plano.gravar.some((c) => c.numero === 12532)).toBe(false);
  });
});
