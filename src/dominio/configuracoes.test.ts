import { describe, expect, it } from "vitest";

import {
  configuracoesVigentes,
  copiaParaEmpresaNova,
  validarValorDeConfiguracao,
} from "./configuracoes";

describe("validarValorDeConfiguracao", () => {
  it("horário HH:MM", () => {
    expect(validarValorDeConfiguracao("whatsapp_horario_envio", " 08:30 ")).toBe("08:30");
    expect(() => validarValorDeConfiguracao("whatsapp_horario_envio", "8:30")).toThrow(
      '"whatsapp_horario_envio" precisa estar no formato HH:MM',
    );
    expect(() => validarValorDeConfiguracao("whatsapp_horario_envio", "24:00")).toThrow(
      "tem hora/minuto inválidos",
    );
  });

  it("responsabilidades em CSV", () => {
    expect(validarValorDeConfiguracao("atrasos_excluir_responsabilidades", "cliente, FR,,")).toBe(
      "cliente,FR",
    );
    expect(() =>
      validarValorDeConfiguracao("atrasos_excluir_responsabilidades", "cliente,fr"),
    ).toThrow('contém responsabilidade inválida: "fr"');
  });

  it("parceiros estratégicos são UUIDs", () => {
    const id = "f0000000-0000-4000-8000-000000000001";
    expect(validarValorDeConfiguracao("parceiros_estrategicos", ` ${id} `)).toBe(id);
    expect(() => validarValorDeConfiguracao("parceiros_estrategicos", "abc")).toThrow(
      'contém UUID inválido: "abc"',
    );
  });

  it("percentual, ponto percentual e inteiro", () => {
    expect(validarValorDeConfiguracao("sla_meta_pct", "95.0")).toBe("95");
    expect(validarValorDeConfiguracao("sla_meta_pct", "92.5")).toBe("92.5");
    expect(() => validarValorDeConfiguracao("sla_meta_pct", "101")).toThrow("entre 0 e 100");
    expect(() => validarValorDeConfiguracao("alerta_queda_sla_pp", "2.5")).toThrow(
      "precisa ser inteiro",
    );
    expect(() => validarValorDeConfiguracao("alerta_dias_sem_movimento", "-1")).toThrow(
      "não pode ser negativo",
    );
    expect(() => validarValorDeConfiguracao("alerta_dias_sem_movimento", "abc")).toThrow(
      "precisa ser numérico",
    );
    expect(validarValorDeConfiguracao("alerta_dias_sem_movimento", "")).toBe("0");
  });
});

describe("copiaParaEmpresaNova", () => {
  it("copia os grupos de negócio e deixa as chaves de infraestrutura", () => {
    expect(copiaParaEmpresaNova({ chave: "sla_meta_pct", grupo: "performance" })).toBe(true);
    expect(copiaParaEmpresaNova({ chave: "otif_visivel", grupo: "empresa" })).toBe(true);
    expect(copiaParaEmpresaNova({ chave: "edge_apikey", grupo: "empresa" })).toBe(false);
    expect(copiaParaEmpresaNova({ chave: "bi2_cursor", grupo: "jobs" })).toBe(false);
  });
});

describe("configuracoesVigentes", () => {
  it("a da empresa vence a da Plataforma, em qualquer ordem de leitura", () => {
    const vigentes = configuracoesVigentes([
      { empresaId: "e1", chave: "sla_meta_pct", valor: "90" },
      { empresaId: null, chave: "sla_meta_pct", valor: "95" },
      { empresaId: null, chave: "otif_visivel", valor: "false" },
    ]);
    expect(vigentes).toEqual(
      new Map([
        ["sla_meta_pct", "90"],
        ["otif_visivel", "false"],
      ]),
    );
  });
});
