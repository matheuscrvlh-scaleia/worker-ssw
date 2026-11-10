import { describe, expect, it } from "vitest";

import { BAIXA_FR, CATALOGO_FR, cte, ocorrencia } from "../testes/nucleo";
import { campoDaColuna, mesclarEscritaBi2 } from "./bi2";
import { CONFIGURACAO_PADRAO } from "./configuracao";
import { type ContextoDoCte, prepararGravacaoDoCte, recalcularDerivadosDoCte } from "./derivar-cte";
import { type OcorrenciaDoCte } from "./ocorrencia";

const d = (iso: string) => new Date(iso);
const contexto = (
  ocorrencias: OcorrenciaDoCte[] = [],
  extra: Partial<ContextoDoCte> = {},
): ContextoDoCte => ({
  ocorrencias,
  catalogo: CATALOGO_FR,
  filiais: [{ sigla: "CAP", cidade: "CAMPINAS", uf: "SP", propria: true }],
  regrasDePrazo: [],
  config: CONFIGURACAO_PADRAO,
  ...extra,
});

describe("escrita do BI2 (§9)", () => {
  const encerrado = cte({
    dataEntregaRealizada: d("2026-11-05T15:00Z"),
    dataPrevistaEntrega: "2026-11-05",
    prazoFonte: "ssw_038",
    camposSsw: ["data_prevista_entrega", "pagador_cnpj"],
    pagadorCnpj: "11.222.333/0001-81",
  });
  const doBi2 = {
    ...encerrado,
    dataPrevistaEntrega: "2026-11-07",
    prazoFonte: "bi2" as const,
    pagadorCnpj: "99",
    unidadeAtual: "RIO",
    camposSsw: [],
  };

  it("CT-e em andamento: o BI2 não altera, com ou sem campos do SSW (Q25)", () => {
    const andamento = cte({ ocorrEfetivaCodigo: "85" });
    expect(mesclarEscritaBi2(andamento, { ...andamento, filial: "X" }, "bi2", BAIXA_FR)).toBe(
      "descartar",
    );
    const semMarca = cte({ camposSsw: [] });
    expect(mesclarEscritaBi2(semMarca, semMarca, "bi2_0017_prazo_entregue", BAIXA_FR)).toBe(
      "descartar",
    );
  });

  it("CT-e cancelado pelo XML não conta como em andamento (cancelado_em)", () => {
    const cancelado = cte({
      ocorrEfetivaCodigo: "85",
      canceladoEm: new Date("2026-11-04T12:00:00Z"),
    });
    const doBi2Cancelado = { ...cancelado, dataEntregaRealizada: new Date("2026-11-05T12:00:00Z") };
    expect(mesclarEscritaBi2(cancelado, doBi2Cancelado, "bi2", BAIXA_FR)).toEqual(doBi2Cancelado);
  });

  it("CT-e encerrado: fonte bi2 mantém as colunas do SSW (previsão leva fonte e base) e a marca", () => {
    expect(mesclarEscritaBi2(encerrado, doBi2, "bi2", BAIXA_FR)).toEqual({
      ...doBi2,
      dataPrevistaEntrega: "2026-11-05",
      prazoFonte: "ssw_038",
      pagadorCnpj: "11.222.333/0001-81",
      camposSsw: ["data_prevista_entrega", "pagador_cnpj"],
    });
  });

  it("bi2_0017_prazo_entregue passa tudo; outra fonte passa tudo", () => {
    expect(mesclarEscritaBi2(encerrado, doBi2, "bi2_0017_prazo_entregue", BAIXA_FR)).toBe(doBi2);
    const andamento = cte({ ocorrEfetivaCodigo: "85" });
    expect(mesclarEscritaBi2(andamento, andamento, "outra", BAIXA_FR)).toBe(andamento);
  });

  it("coluna do banco → campo", () => {
    expect(campoDaColuna("data_prevista_entrega")).toBe("dataPrevistaEntrega");
    expect(campoDaColuna("ult_ocorr_codigo_0174")).toBe("ultOcorrCodigo0174");
  });
});

describe("recalcularDerivadosDoCte (§11.3)", () => {
  it("recalcula tudo na ordem: 80 → efetiva → conclusão → prazo → universo", () => {
    const base = cte({
      dataEmissao: "2026-11-05",
      filial: "cap",
      unidadeAtual: "RIO",
      pagadorCnpj: "11.222.333/0001-81",
      dataPrevistaEntrega: "2026-11-06",
      prazoFonte: "ssw_038",
    });
    const oc = [
      // 85 do dia 04 só passa no filtro de emissão porque a 80 antecipa a emissão (Q20).
      ocorrencia(80, "2026-11-03T12:00Z"),
      ocorrencia(85, "2026-11-04T12:00Z", { descricao: "Saiu" }),
      ocorrencia(12, "2026-11-04T18:00Z"),
    ];
    expect(recalcularDerivadosDoCte(base, contexto(oc))).toEqual({
      dataEmissao: "2026-11-03",
      unidadeCidade: "CAMPINAS",
      unidadeUf: "SP",
      filialEfetiva: "RIO",
      pagadorCnpjDigitos: "11222333000181",
      canceladoMesmoDia: false,
      ocorrEfetivaCodigo: "12",
      ocorrEfetivaDescricao: "Código 12",
      ocorrEfetivaData: d("2026-11-04T18:00Z"),
      ocorrEfetivaFonte: "webhook",
      ocorrEfetivaLocal: null,
      ocorrEfetivaCodigoNum: 12,
      dataConclusaoEfetiva: "2026-11-04",
      dataPrevistaEntrega: "2026-11-06",
      prazoFonte: "ssw_038",
      dataBasePrazo: null,
      previsaoSswData: "2026-11-06",
      previsaoSswFonte: "ssw_038",
      previsaoSswDataBase: null,
      prazoPadraoDias: 2,
      prazoPadraoData: "2026-11-05",
      dataEmbarque: "2026-11-04",
      statusAtual: "Código 12",
      foraUniverso: false,
    });
  });

  it("cancelado no mesmo dia e cópia saem do universo; sem ocorrência mantém embarque e status", () => {
    const base = cte({ dataEmbarque: "2026-11-04", statusAtual: "ANTIGO" });
    const cancelado = recalcularDerivadosDoCte(
      base,
      contexto([ocorrencia(99, "2026-11-03T15:00Z")]),
    );
    expect(cancelado.canceladoMesmoDia).toBe(true);
    expect(cancelado.foraUniverso).toBe(true);
    const copia = recalcularDerivadosDoCte({ ...base, duplicadoDe: "outro" }, contexto());
    expect(copia).toMatchObject({
      foraUniverso: true,
      dataEmbarque: "2026-11-04",
      statusAtual: "ANTIGO",
    });
  });
});

describe("prepararGravacaoDoCte (§11)", () => {
  it("criação abaixo da data mínima ou pelo BI2 é descartada", () => {
    const novo = cte({ dataEmissao: "2026-08-31" });
    const config = { ...CONFIGURACAO_PADRAO, dataMinimaEmissao: "2026-09-01" };
    expect(
      prepararGravacaoDoCte({
        antigo: null,
        novo,
        fonte: "outra",
        contexto: contexto([], { config }),
      }),
    ).toEqual({ tipo: "descartar", motivo: "abaixo_da_data_minima" });
    expect(
      prepararGravacaoDoCte({ antigo: null, novo: cte(), fonte: "bi2", contexto: contexto() }),
    ).toEqual({
      tipo: "descartar",
      motivo: "bi2_nao_cria_cte",
    });
  });

  it("data mínima não vale para atualização", () => {
    const antigo = cte({ dataEmissao: "2026-08-31" });
    const config = { ...CONFIGURACAO_PADRAO, dataMinimaEmissao: "2026-09-01" };
    const r = prepararGravacaoDoCte({
      antigo,
      novo: antigo,
      fonte: "outra",
      contexto: contexto([], { config }),
    });
    expect(r.tipo).toBe("gravar");
  });

  it("BI2 em CT-e em andamento é descartado", () => {
    const antigo = cte({ ocorrEfetivaCodigo: "85" });
    expect(
      prepararGravacaoDoCte({ antigo, novo: antigo, fonte: "bi2", contexto: contexto() }),
    ).toEqual({ tipo: "descartar", motivo: "bi2_nao_altera_cte_em_andamento" });
  });

  it("criação grava com derivados; regravar igual não muda nada", () => {
    const criado = prepararGravacaoDoCte({
      antigo: null,
      novo: cte(),
      fonte: "outra",
      contexto: contexto(),
    });
    expect(criado).toMatchObject({ tipo: "gravar", mudou: true, trocaDePrevisao: null });
    if (criado.tipo !== "gravar") return;
    expect(criado.cte.prazoPadraoData).toBe("2026-11-05");
    const regravado = prepararGravacaoDoCte({
      antigo: criado.cte,
      novo: { ...criado.cte },
      fonte: "outra",
      contexto: contexto(),
    });
    expect(regravado).toMatchObject({ tipo: "gravar", mudou: false, trocaDePrevisao: null });
  });

  it("troca de previsão gera histórico com a fonte nova", () => {
    const antigo = cte({ dataPrevistaEntrega: "2026-11-06", prazoFonte: "ssw_038" });
    const r = prepararGravacaoDoCte({
      antigo,
      novo: { ...antigo, dataPrevistaEntrega: "2026-11-08", prazoFonte: "ssw_manual" },
      fonte: "outra",
      contexto: contexto(),
    });
    expect(r).toMatchObject({
      tipo: "gravar",
      mudou: true,
      trocaDePrevisao: { dataAnterior: "2026-11-06", dataNova: "2026-11-08", fonte: "ssw_manual" },
    });
  });

  it("chegada 84 aplica a regra de unidade a um CT-e já existente (Q19)", () => {
    const antigo = cte({ filial: "CAP", dataPrevistaEntrega: "2026-11-09", prazoFonte: "ssw_038" });
    const regra = {
      id: "r1",
      tipo: "unidade" as const,
      unidadeCodigo: "CAP",
      unidadeDestinoCodigo: null,
      parceiroCnpj: null,
      prazoHoras: 24,
      prazoDias: null,
      ativo: true,
      criadoEm: d("2026-10-01T00:00Z"),
    };
    const chegada = ocorrencia(84, "2026-11-04T15:00Z", { filial: "CAP" });
    const r = prepararGravacaoDoCte({
      antigo,
      novo: antigo,
      fonte: "outra",
      contexto: contexto([chegada], { regrasDePrazo: [regra] }),
    });
    expect(r).toMatchObject({
      tipo: "gravar",
      cte: {
        dataPrevistaEntrega: "2026-11-05",
        prazoFonte: "regra_unidade",
        previsaoSswData: "2026-11-09",
      },
      trocaDePrevisao: {
        dataAnterior: "2026-11-09",
        dataNova: "2026-11-05",
        fonte: "regra_unidade",
      },
    });
  });
});
