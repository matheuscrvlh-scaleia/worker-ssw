import { describe, expect, it } from "vitest";

import { CADASTRO_FR, linha036, ocorrencia } from "../tests/manifest";
import { type CteDoDia, ctesDaFaixa, romaneioDoDia } from "./today";

const DIA = "2026-11-10";
const filtros = { dia: DIA, filiais: null, tipos: null };

function cte(extra: Partial<CteDoDia> = {}): CteDoDia {
  return {
    id: "c1",
    sigla: "CAP",
    numero: "38984",
    foraUniverso: false,
    dataEmissao: "2026-11-09",
    dataPrevista: "2026-11-10",
    dataEntregaRealizada: null,
    criadoEm: new Date("2026-11-09T10:00:00Z"),
    ocorrEfetivaCodigo: "85",
    valorFrete: 250,
    tipoDocumento: "NORMAL",
    unidadeResponsavel: "CAP",
    numeroNf: 123,
    destinatario: "CLIENTE",
    pagadorNome: "PAGADOR",
    cidadeDestino: "CAMPINAS",
    ufDestino: "SP",
    ocorrencias: [],
    ...extra,
  };
}

describe("aba Hoje", () => {
  it("o CT-e em dois romaneios do dia conta só no da ocorrência mais recente", () => {
    const linhas = [
      linha036({ romaneio: "A", dataOcorrCtrc: DIA, horaOcorrCtrc: "09:10" }),
      linha036({ romaneio: "B", dataOcorrCtrc: DIA, horaOcorrCtrc: "14:30" }),
    ];
    const { linhas: tabela, resumo } = romaneioDoDia(linhas, [cte()], filtros, CADASTRO_FR, [13]);
    expect(tabela.map((l) => [l.romaneio, l.ctes])).toEqual([
      ["B", 1],
      ["A", 0],
    ]);
    expect(resumo).toMatchObject({ romaneios: 2, ctes: 1, frete: 250, entregues: 0 });
    expect(resumo.prazo).toEqual({ vencida: 0, hoje: 1, futuro: 0, semPrev: 0 });
    expect(tabela[0]).toMatchObject({ placa: "KQK6I98", rota: "CAMPINAS", bairros: "CENTRO" });
  });

  it("linha cancelada, de outro dia ou sem número não entra", () => {
    const linhas = [
      linha036({ situacao: "CANCELADO" }),
      linha036({ dataEmissao: "2026-11-09" }),
      linha036({ ctrc: "CAP" }),
    ];
    expect(romaneioDoDia(linhas, [cte()], filtros, CADASTRO_FR, [13]).resumo.romaneios).toBe(0);
  });

  it("CT-e cancelado ou cópia (fora do universo) não aparece (Q18)", () => {
    const r = romaneioDoDia(
      [linha036()],
      [cte({ foraUniverso: true })],
      filtros,
      CADASTRO_FR,
      [13],
    );
    expect(r.resumo.ctes).toBe(0);
  });

  it("sigla da linha diferente da do CT-e não casa (Q02); linha sem CT-e conta com frete 0", () => {
    const r = romaneioDoDia(
      [linha036({ ctrc: "CAS038984-6" })],
      [cte()],
      filtros,
      CADASTRO_FR,
      [13],
    );
    expect(r.resumo).toMatchObject({ ctes: 1, frete: 0 });
  });

  it("prejuízo do dia pela ocorrência penalizante lançada hoje", () => {
    const c = cte({ ocorrencias: [ocorrencia(13, "2026-11-10T15:00:00Z")] });
    const r = romaneioDoDia([linha036()], [c], filtros, CADASTRO_FR, [13]);
    expect(r.resumo).toMatchObject({ prejuizoCtes: 1, prejuizoFrete: 250 });
  });

  it("gaveta: status, só não entregues e ordem por previsão antes do corte (Q04)", () => {
    const linhas = [linha036({ ctrc: "CAP000002-1" }), linha036({ ctrc: "CAP000001-1" })];
    const ctes = [
      cte({ id: "a", numero: "2", dataPrevista: "2026-11-12", ocorrEfetivaCodigo: "1" }),
      cte({ id: "b", numero: "1", dataPrevista: null }),
    ];
    const todas = ctesDaFaixa(linhas, ctes, filtros, "todas", false, CADASTRO_FR);
    expect(todas.linhas.map((l) => [l.numero, l.status])).toEqual([
      ["2", "Entregue"],
      ["1", "Em rota"],
    ]);
    const abertas = ctesDaFaixa(linhas, ctes, filtros, "todas", true, CADASTRO_FR);
    expect(abertas.total).toBe(1);
    expect(ctesDaFaixa(linhas, ctes, filtros, "sem_prev", false, CADASTRO_FR).total).toBe(1);
  });
});
