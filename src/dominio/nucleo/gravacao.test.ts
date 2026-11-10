import { describe, expect, it } from "vitest";

import { CATALOGO_FR, ocorrencia } from "../testes/nucleo";
import { montarCatalogo } from "./codigos";
import {
  cidadeDoComplemento,
  codigoRecebidoSemCadastro,
  dataEmbarque,
  derivarResponsavelPeloTipo,
  efeitoDaAlteracaoDeCodigo,
  emissaoAncoradaNo80,
  entraEmQuarentena,
  type OcorrenciaRecebida,
  prepararOcorrencia,
} from "./gravacao-ocorrencia";
import { abaixoDaDataMinima, canceladoMesmoDia, foraDoUniverso } from "./universo";

const d = (iso: string) => new Date(iso);
const CTE = { dataEmissao: "2026-11-05", criadoEm: d("2026-11-05T12:00Z") };

describe("universo (§7)", () => {
  it("data mínima: emissão anterior não entra; sem configuração, tudo entra", () => {
    expect(abaixoDaDataMinima("2026-08-31", "2026-09-01")).toBe(true);
    expect(abaixoDaDataMinima("2026-09-01", "2026-09-01")).toBe(false);
    expect(abaixoDaDataMinima("2020-01-01", null)).toBe(false);
  });

  it("cancelado no mesmo dia de Brasília", () => {
    expect(canceladoMesmoDia("2026-11-05", [ocorrencia(99, "2026-11-06T02:30Z")])).toBe(true);
    expect(canceladoMesmoDia("2026-11-05", [ocorrencia(99, "2026-11-06T13:00Z")])).toBe(false);
    expect(canceladoMesmoDia("2026-11-05", [ocorrencia(12, "2026-11-05T13:00Z")])).toBe(false);
  });

  it("99 em quarentena não cancela (Q21)", () => {
    const quarentena = ocorrencia(99, "2026-11-05T13:00Z", { quarentena: true });
    expect(canceladoMesmoDia("2026-11-05", [quarentena])).toBe(false);
  });

  it("fora do universo = cancelado no mesmo dia ou cópia", () => {
    expect(foraDoUniverso(false, null)).toBe(false);
    expect(foraDoUniverso(true, null)).toBe(true);
    expect(foraDoUniverso(false, "id-do-certo")).toBe(true);
  });
});

describe("quarentena (§8.1)", () => {
  it("dia de Brasília antes da emissão", () => {
    expect(entraEmQuarentena({ dataHora: d("2026-11-05T02:00Z"), origem: "webhook" }, CTE)).toBe(
      true,
    );
    expect(entraEmQuarentena({ dataHora: d("2026-11-05T03:00Z"), origem: "webhook" }, CTE)).toBe(
      false,
    );
  });

  it("trackingdanfe mais de 400 dias antes da criação do CT-e", () => {
    const antigo = { dataEmissao: "2024-01-01", criadoEm: d("2026-11-05T12:00Z") };
    const evento = d("2025-09-01T12:00Z");
    expect(entraEmQuarentena({ dataHora: evento, origem: "trackingdanfe" }, antigo)).toBe(true);
    expect(entraEmQuarentena({ dataHora: evento, origem: "webhook" }, antigo)).toBe(false);
  });
});

describe("prepararOcorrencia (§8.1–8.3)", () => {
  const recebida = (extra: Partial<OcorrenciaRecebida> = {}): OcorrenciaRecebida => ({
    codigo: 9,
    dataHora: d("2026-11-06T12:00Z"),
    origem: "webhook",
    responsavel: null,
    quarentena: false,
    ...extra,
  });
  const catalogo = montarCatalogo([
    {
      codigo: 9,
      descricao: "CLIENTE AUSENTE",
      tipoSsw: "PENDENCIA_CLIENTE",
      processoSsw: "ENTREGA",
      responsavel: "destinatario",
      penaliza: true,
    },
  ]);
  const empresa = { dominioSsw: "FRT", filiaisProprias: new Set(["CAP", "RIO"]) };
  const preparar = (
    o: OcorrenciaRecebida,
    trackingdanfe: { dominio: string | null; filial: string | null } | null = null,
  ) => prepararOcorrencia({ ocorrencia: o, cte: CTE, catalogo, empresa, trackingdanfe });

  it("responsável do cadastro quando não veio; penaliza sempre do cadastro", () => {
    expect(preparar(recebida())).toEqual({
      tipo: "gravar",
      quarentena: false,
      responsavel: "destinatario",
      penaliza: true,
    });
    expect(preparar(recebida({ responsavel: "FR" }))).toMatchObject({
      responsavel: "FR",
      penaliza: true,
    });
  });

  it("liga a quarentena; nunca desliga a recebida", () => {
    expect(preparar(recebida({ dataHora: d("2026-11-04T12:00Z") }))).toMatchObject({
      quarentena: true,
    });
    expect(preparar(recebida({ quarentena: true }))).toMatchObject({ quarentena: true });
  });

  it("trackingdanfe: domínio da empresa, ou sem domínio com filial própria; senão descarta", () => {
    const td = recebida({ origem: "trackingdanfe" });
    expect(preparar(td, { dominio: "FRT", filial: null }).tipo).toBe("gravar");
    expect(preparar(td, { dominio: null, filial: "CAP" }).tipo).toBe("gravar");
    expect(preparar(td, { dominio: "OUTRA", filial: "CAP" })).toEqual({
      tipo: "descartar",
      motivo: "ocorrencia_dominio_invalido: dominio=OUTRA filial=CAP",
    });
    expect(preparar(td, null).tipo).toBe("descartar");
    expect(preparar(recebida(), { dominio: "OUTRA", filial: null }).tipo).toBe("gravar");
  });

  it("código sem cadastro é erro (a ingestão garante o código antes)", () => {
    expect(() => preparar(recebida({ codigo: 77 }))).toThrow("sem cadastro");
  });
});

describe("catálogo de códigos (§8.4–8.6)", () => {
  it("código novo do SSW entra pendente, sem tipo, responsável 'outro'", () => {
    expect(codigoRecebidoSemCadastro(55, "  Avaria  ")).toEqual({
      codigo: 55,
      descricao: "Avaria",
      tipoSsw: null,
      processoSsw: null,
      responsavel: "outro",
      letraResponsavel: "O",
      penaliza: false,
      pendenteClassificacao: true,
      ativo: true,
    });
    expect(codigoRecebidoSemCadastro(55, " ")?.descricao).toBe("Recebido via SSW");
    expect(codigoRecebidoSemCadastro(100, "x")).toBeNull();
    expect(codigoRecebidoSemCadastro(-1, "x")).toBeNull();
  });

  it.each([
    [null, null, null],
    [
      "PENDENCIA_TRANSPORTADORA",
      null,
      { responsavel: "FR", letraResponsavel: "F", penaliza: true },
    ],
    [
      "PENDENCIA_CLIENTE",
      "ENTREGA",
      { responsavel: "destinatario", letraResponsavel: "D", penaliza: false },
    ],
    [
      "PENDENCIA_CLIENTE",
      "REENTREGA",
      { responsavel: "destinatario", letraResponsavel: "D", penaliza: false },
    ],
    [
      "PENDENCIA_CLIENTE",
      "COLETA",
      { responsavel: "cliente", letraResponsavel: "C", penaliza: false },
    ],
    ["BAIXA", null, { responsavel: "sistema", letraResponsavel: "S", penaliza: false }],
  ] as const)("tipo %j, processo %j", (tipo, processo, esperado) => {
    expect(derivarResponsavelPeloTipo(tipo, processo)).toEqual(esperado);
  });

  it("alteração de código: regrava responsável/penaliza; recalcula CT-e se mudou tipo ou descrição (Q20)", () => {
    const antes = CATALOGO_FR.get(85);
    expect(antes).toBeDefined();
    if (antes === undefined) return;
    expect(efeitoDaAlteracaoDeCodigo(antes, { ...antes, penaliza: true })).toEqual({
      regravarOcorrencias: { responsavel: "sistema", penaliza: true },
      recalcularCtes: false,
    });
    expect(efeitoDaAlteracaoDeCodigo(antes, { ...antes, tipoSsw: "INFORMATIVA" })).toEqual({
      regravarOcorrencias: null,
      recalcularCtes: true,
    });
    expect(efeitoDaAlteracaoDeCodigo(antes, { ...antes, descricao: "SAIU" }).recalcularCtes).toBe(
      true,
    );
  });
});

describe("efeitos da ocorrência no CT-e (§8.7–8.9)", () => {
  it("embarque = menor dia (Brasília) das 82/85, sem quarentena (Q21)", () => {
    expect(
      dataEmbarque([
        ocorrencia(85, "2026-11-07T12:00Z"),
        ocorrencia(82, "2026-11-06T02:00Z"),
        ocorrencia(82, "2026-11-04T12:00Z", { quarentena: true }),
        ocorrencia(88, "2026-11-01T12:00Z"),
      ]),
    ).toBe("2026-11-05");
    expect(dataEmbarque([])).toBeNull();
  });

  it("80 antecipa a emissão, nunca adia; quarentena e trackingdanfe antigo não valem", () => {
    expect(emissaoAncoradaNo80(CTE, [ocorrencia(80, "2026-11-03T12:00Z")])).toBe("2026-11-03");
    expect(emissaoAncoradaNo80(CTE, [ocorrencia(80, "2026-11-07T12:00Z")])).toBe("2026-11-05");
    expect(
      emissaoAncoradaNo80(CTE, [ocorrencia(80, "2026-11-03T12:00Z", { quarentena: true })]),
    ).toBe("2026-11-05");
    expect(
      emissaoAncoradaNo80(CTE, [
        ocorrencia(80, "2025-01-01T12:00Z", { origem: "trackingdanfe" }),
        ocorrencia(80, "2026-11-04T12:00Z", { origem: "trackingdanfe" }),
      ]),
    ).toBe("2026-11-04");
  });

  it("cidade do complemento do webhook", () => {
    expect(cidadeDoComplemento("Chegada na unidade SAO JOAO DE MERITI em 02/07/26, 01:14h.")).toBe(
      "SAO JOAO DE MERITI",
    );
    expect(cidadeDoComplemento("Unidade X em 1")).toBeNull();
    expect(cidadeDoComplemento("unidade A em 1 e unidade B em 2")).toBe("A EM 1 E UNIDADE B");
    expect(cidadeDoComplemento(null)).toBeNull();
  });
});
