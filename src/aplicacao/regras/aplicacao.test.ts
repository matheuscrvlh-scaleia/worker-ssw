import { describe, expect, it } from "vitest";

import { cteDeTeste, linha } from "../../testes/cte";
import { r036, r038, r455, r930 } from "../../testes/registros";
import {
  agregar455,
  agregar930,
  anuladas930,
  avaliarCiclo,
  camposDo036,
  camposDoCteNovo,
  camposSswDoCte,
  type Candidato,
  dataEntregaAgendada,
  diferencasDoCte,
  efeitoDoEstorno,
  linha036QueVale,
  mensagemDaSincronizacao,
  montarCandidato,
  ocorrenciasDo930,
  partesDo455,
  precisaPreparacaoCompleta,
  ultimo038,
  unidadePelo455,
} from ".";

const CHAVE = { sigla: "CAP", numero: "33214" };
const FINALIZADORES = new Set([1, 18, 67, 12, 36, 61, 77, 92, 93, 94, 99]);

function candidato(entrada: {
  l930?: ReturnType<typeof linha<ReturnType<typeof r930>>>[];
  l038?: ReturnType<typeof linha<ReturnType<typeof r038>>>[];
  l455?: ReturnType<typeof linha<ReturnType<typeof r455>>>[];
  entregue?: boolean;
}): Candidato {
  const l930 = entrada.l930 ?? [];
  const anul = anuladas930(l930, FINALIZADORES);
  return montarCandidato({
    chave: CHAVE,
    c: agregar930(l930, anul),
    b: agregar455(entrada.l455 ?? []),
    a: ultimo038(entrada.l038 ?? []),
    prod: entrada.entregue ? { dataEntregaRealizada: new Date("2026-11-05T15:00:00Z") } : null,
    dominioSsw: "FRT",
  });
}

describe("previsão (038, 455 e agendamento do 930)", () => {
  // 038 importado às 10:00 de São Paulo com prazo 12/11.
  const l038 = [linha(r038({ prazo_entrega: "2026-11-12" }), "2026-11-04T13:00:00Z")];
  const agendamento = (inclusao: string) =>
    linha(
      r930({
        cod_ocor: "15",
        complemento_ocor: "ENTREGA AGENDADA P/ 15/11/26 PELO CLIENTE",
        inclusao_em: inclusao,
        ocorrencia_em: inclusao,
      }),
      "2026-11-04T14:00:00Z",
    );

  it("agendamento incluído depois do 038 vence; antes, vale o 038", () => {
    expect(candidato({ l038, l930: [agendamento("2026-11-04T10:30:00")] }).previsao).toBe(
      "2026-11-15",
    );
    expect(candidato({ l038, l930: [agendamento("2026-11-04T09:30:00")] }).previsao).toBe(
      "2026-11-12",
    );
  });

  it("CT-e entregue ignora o agendamento; agendada antes da emissão também", () => {
    expect(
      candidato({ l038, l930: [agendamento("2026-11-04T10:30:00")], entregue: true }).previsao,
    ).toBe("2026-11-12");
    const antes = linha(
      r930({
        cod_ocor: "15",
        emissao_ctrc: "2026-11-20",
        complemento_ocor: "AGENDADA P/ 15/11/26",
        inclusao_em: "2026-11-04T10:30:00",
      }),
      "2026-11-04T14:00:00Z",
    );
    expect(candidato({ l038, l930: [antes] }).previsao).toBe("2026-11-12");
  });

  it("455 importado depois do 038 vence; 038 sem prazo também cede ao 455", () => {
    const l455 = [linha(r455({ previsao_de_entrega: "2026-11-14" }), "2026-11-04T15:00:00Z")];
    expect(candidato({ l038, l455 }).previsao).toBe("2026-11-14");
    const semPrazo = [
      linha(r038({ sem_prazo_definido: true, prazo_entrega: null }), "2026-11-04T16:00:00Z"),
    ];
    expect(candidato({ l038: semPrazo, l455 }).previsao).toBe("2026-11-14");
  });

  it("data agendada inexistente é ignorada", () => {
    expect(dataEntregaAgendada("AGENDADA P/ 31/02/26")).toBeNull();
    expect(dataEntregaAgendada("AGENDADA P/ 01/03/26")).toBe("2026-03-01");
  });
});

describe("entrega e estorno (86)", () => {
  const baixa = (hora: string, cod = "1") =>
    linha(
      r930({
        cod_ocor: cod,
        ocorrencia_em: `2026-11-04T${hora}`,
        inclusao_em: `2026-11-04T${hora}`,
      }),
      "2026-11-04T18:00:00Z",
    );

  it("baixa antes do estorno não vale: CT-e sem entrega e ocorrência apagada", () => {
    const linhas = [baixa("10:00:00"), baixa("11:00:00", "86")];
    const anul = anuladas930(linhas, FINALIZADORES);
    expect(anul.has(linhas[0]!.id)).toBe(true);
    expect(candidato({ l930: linhas }).dataEntregaRealizada).toBeNull();
    const efeito = efeitoDoEstorno(linhas, anul, FINALIZADORES, new Date("2026-11-04T13:00:00Z"));
    expect(efeito.apagar).toEqual([{ codigo: 1, dataHora: new Date("2026-11-04T13:00:00Z") }]);
    expect(efeito.entrega).toBeNull();
  });

  it("nova baixa depois do estorno: o 86 sai e a entrega é a nova", () => {
    const linhas = [baixa("10:00:00"), baixa("11:00:00", "86"), baixa("12:00:00")];
    const anul = anuladas930(linhas, FINALIZADORES);
    expect(anul.has(linhas[1]!.id)).toBe(true);
    expect(candidato({ l930: linhas }).dataEntregaRealizada).toEqual(
      new Date("2026-11-04T15:00:00Z"),
    );
    const efeito = efeitoDoEstorno(linhas, anul, FINALIZADORES, null);
    expect(efeito.entrega).toEqual(new Date("2026-11-04T15:00:00Z"));
  });

  it("baixa relançada idêntica não é apagada", () => {
    const linhas = [baixa("10:00:00"), baixa("11:00:00", "86"), baixa("10:00:00")];
    // A segunda baixa idêntica tem inclusão igual: só a primeira (anterior ao estorno) é anulada.
    const anul = new Set([linhas[0]!.id]);
    expect(efeitoDoEstorno(linhas, anul, FINALIZADORES, null).apagar).toEqual([]);
  });

  it("entrega só com a data (cód. 99) vira meia-noite de Brasília (Q11)", () => {
    const l = [linha(r930({ cod_ocor: "99", data_entrega: "2026-11-04" }), "2026-11-04T18:00:00Z")];
    expect(candidato({ l930: l }).dataEntregaRealizada).toEqual(new Date("2026-11-04T03:00:00Z"));
  });
});

describe("ocorrências do 930", () => {
  it("930 de outra emissão não liga ao CT-e; anulada e sem hora ficam fora", () => {
    const l = [
      linha(
        r930({ cod_ocor: "85", ocorrencia_em: "2026-11-04T08:00:00", unid_ocor: " CAP " }),
        "2026-11-04T12:00:00Z",
      ),
      linha(
        r930({ cod_ocor: "85", ocorrencia_em: "2026-11-04T08:00:00", emissao_ctrc: "2026-03-01" }),
        "2026-11-04T12:00:00Z",
      ),
      linha(r930({ cod_ocor: "84" }), "2026-11-04T12:00:00Z"),
    ];
    const oc = ocorrenciasDo930(l, new Set(), "2026-11-03");
    expect(oc).toEqual([
      {
        codigo: 85,
        dataHora: new Date("2026-11-04T11:00:00Z"),
        descricao: null,
        complemento: null,
        filial: "CAP",
      },
    ]);
  });
});

describe("gravação do CT-e", () => {
  const cand = candidato({
    l038: [linha(r038({ atraso: 4 }), "2026-11-04T13:00:00Z")],
    l455: [
      linha(r455({ tipo_do_documento: "normal", valor_do_frete: 99.9 }), "2026-11-04T12:00:00Z"),
    ],
    l930: [
      linha(r930({ cod_ocor: "84", ocorrencia_em: "2026-11-04T08:00:00" }), "2026-11-04T12:00:00Z"),
    ],
  });

  it("CT-e novo: filial = sigla, prazo do SSW", () => {
    expect(camposDoCteNovo(cand)).toMatchObject({
      filial: "CAP",
      dataEmissao: "2026-11-03",
      prazoFonte: "ssw_manual",
      prazoEntrega: "2026-11-12",
      valorFrete: "99.90",
      unidadeAtual: "CAP",
    });
  });

  it("atualização: atraso e tipo do 455 sobrescrevem, remetente só preenche vazio, emissão sobrescreve", () => {
    const p = cteDeTeste({
      dataEmissao: "2026-11-02",
      remetente: "OUTRO",
      atrasoDias: 1,
      tipoDocumento455: "X",
    });
    const d = diferencasDoCte(p, cand);
    expect(d).toMatchObject({
      dataEmissao: "2026-11-03",
      atrasoDias: 4,
      tipoDocumento455: "NORMAL",
    });
    expect(d.remetente).toBeUndefined();
    expect(diferencasDoCte(cteDeTeste({ remetente: "  " }), cand).remetente).toBe("REMETENTE X");
  });

  it("CT-e com prazo de regra recebe a previsão do SSW à parte (Q19)", () => {
    const p = cteDeTeste({ prazoFonte: "regra_parceiro", dataPrevistaEntrega: "2026-11-20" });
    const d = diferencasDoCte(p, cand);
    expect(d.previsaoSswData).toBe("2026-11-12");
    expect(d.dataPrevistaEntrega).toBeUndefined();
  });

  it("campos_ssw só ganha a coluna quando o valor gravado é igual ao do candidato", () => {
    const gravado = cteDeTeste({ remetente: "REMETENTE X", setor: "OUTRO", camposSsw: ["sigla"] });
    const marcas = camposSswDoCte(gravado, cand);
    expect(marcas).toContain("remetente");
    expect(marcas).not.toContain("setor");
    expect(marcas).toEqual([...marcas].sort());
  });
});

describe("partes do 455", () => {
  const proprios = new Set(["99888777000166"]);
  const doc = (expedidor: string, remetente = "11222333000181") => [
    linha(
      r455({
        cnpj_expedidor: expedidor,
        cnpj_remetente: remetente,
        cliente_expedidor: "001989-TORCH",
      }),
      "2026-11-04T12:00:00Z",
    ),
  ];

  it("expedidor = remetente zera o parceiro anterior; CNPJ próprio também", () => {
    const p = cteDeTeste({ parceiroCnpj: "55.666.777/0001-88", parceiroNome: "VELHO" });
    expect(partesDo455(p, doc("11222333000181"), proprios)?.campos).toMatchObject({
      parceiroCnpj: null,
      parceiroNome: null,
    });
    expect(partesDo455(p, doc("99888777000166"), proprios)?.campos.parceiroCnpj).toBeNull();
    expect(partesDo455(cteDeTeste(), doc("55666777000188"), proprios)?.campos).toMatchObject({
      parceiroCnpj: "55.666.777/0001-88",
      parceiroNome: "TORCH",
    });
  });

  it("CPF de 14 dígitos começando com 000 sai com máscara de CPF", () => {
    const r = partesDo455(cteDeTeste(), doc("55666777000188", "00052998224725"), proprios);
    expect(r?.campos.cnpjRemetente).toBe("529.982.247-25");
  });

  it("unidade pelo 455 só troca filial nula ou não própria", () => {
    const ultima = r455({ unidade_emissora: " ara ", unidade_receptora: "rio" });
    expect(
      unidadePelo455({ filial: null, unidadeDestino: null }, ultima, new Set(["CAP"])),
    ).toEqual({
      filial: "ARA",
      unidadeDestino: "RIO",
    });
    expect(
      unidadePelo455({ filial: "CAP", unidadeDestino: null }, ultima, new Set(["CAP"])),
    ).toEqual({});
  });
});

describe("036", () => {
  it("vale a importação mais nova; empate: BAIXADO primeiro", () => {
    const a = linha(r036({ romaneio: "CAP 1", situacao: "EM ROTA" }), "2026-11-04T12:00:00Z");
    const b = linha(
      r036({ romaneio: "CAP 1", situacao: "BAIXADO", ajudante: "ZE" }),
      "2026-11-04T12:00:00Z",
    );
    expect(linha036QueVale([a, b])).toBe(b);
    const campos = camposDo036(
      { ajudanteNome: null, ocorr036Codigo: null, ocorr036Descricao: null, ocorr036Data: null },
      r036({ ajudante: "ZE", cod_ocorr_ctrc: "1", data_ocorr_ctrc: "2026-11-04" }),
    );
    expect(campos.ocorr036Data).toEqual(new Date("2026-11-04T15:00:00Z"));
  });
});

describe("ciclo e fila", () => {
  it("faltantes por unidade; pode aplicar com qualquer arquivo importado", () => {
    const r = avaliarCiclo(
      [{ relatorio: "038", unidade: "ARA", status: "importado" }],
      [
        {
          relatorio: "038",
          porUnidade: true,
          unidadesEsperadas: ["ARA", "RIO"],
          obrigatorioNoCiclo: true,
          ativo: true,
        },
        {
          relatorio: "930",
          porUnidade: false,
          unidadesEsperadas: [],
          obrigatorioNoCiclo: true,
          ativo: true,
        },
      ],
    );
    expect(r).toEqual({
      faltantes: ["038/RIO", "930"],
      motivo: "relatórios ausentes neste lote: 038/RIO, 930",
      podeFechar: true,
    });
  });

  it("preparação completa uma vez por dia depois das 03:00 de São Paulo", () => {
    const completaOntem = new Date("2026-11-09T06:05:00Z"); // 03:05 SP de 09/11
    const controle = { ultimaPreparacaoEm: completaOntem, ultimaCompletaEm: completaOntem };
    expect(precisaPreparacaoCompleta(new Date("2026-11-10T05:00:00Z"), controle)).toBe(false); // 02:00 SP
    expect(precisaPreparacaoCompleta(new Date("2026-11-10T06:30:00Z"), controle)).toBe(true); // 03:30 SP
    expect(
      precisaPreparacaoCompleta(new Date(), { ultimaPreparacaoEm: null, ultimaCompletaEm: null }),
    ).toBe(true);
  });

  it("mensagens da sincronização", () => {
    expect(mensagemDaSincronizacao({ movidos: 0, comErro: 0, pastasLimpas: 1 })).toBe(
      "Nenhum arquivo pendente no FTP; 1 pasta(s) antiga(s) removida(s)",
    );
    expect(mensagemDaSincronizacao({ movidos: 3, comErro: 1, pastasLimpas: 0 })).toBe(
      "3 movido(s), 1 com erro",
    );
  });
});
