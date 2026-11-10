import { describe, expect, it } from "vitest";

import {
  DADOS_DOS_JOBS,
  erroInterno,
  execucaoCriada,
  EXEMPLOS,
  JOBS_PEDIVEIS,
  pedidoDeExecucao,
  situacaoDaEmpresa,
  situacaoDaExecucao,
} from "./contrato-interno";

/** O mesmo teste roda no ERP, sobre a cópia em packages/shared/src/contratos/worker-ssw.ts. */
describe("contrato do HTTP interno", () => {
  it("os exemplos valem pelo contrato", () => {
    expect(pedidoDeExecucao.parse(EXEMPLOS.pedido)).toEqual(EXEMPLOS.pedido);
    expect(DADOS_DOS_JOBS[EXEMPLOS.pedido.job].parse(EXEMPLOS.pedido.dados)).toEqual(
      EXEMPLOS.pedido.dados,
    );
    expect(execucaoCriada.parse(EXEMPLOS.criada)).toEqual(EXEMPLOS.criada);
    expect(situacaoDaExecucao.parse(EXEMPLOS.concluida)).toEqual(EXEMPLOS.concluida);
    expect(situacaoDaExecucao.parse(EXEMPLOS.falhou)).toEqual(EXEMPLOS.falhou);
    expect(situacaoDaEmpresa.parse(EXEMPLOS.situacao)).toEqual(EXEMPLOS.situacao);
    expect(erroInterno.parse(EXEMPLOS.erro)).toEqual(EXEMPLOS.erro);
  });

  it("só os jobs da lista do ADR 0012; campo desconhecido é recusado", () => {
    expect(JOBS_PEDIVEIS).toEqual([
      "sincronizar-ftp",
      "sincronizar-ftp-retroativo",
      "aplicar-ciclos",
      "bi2-0017",
      "verificar-token-ssw",
      "processar-webhook-ssw",
      "reprocessar-xml-orfaos",
      "projecoes-romaneio",
      "projecoes-romaneio-completa",
    ]);
    expect(pedidoDeExecucao.safeParse({ job: "sla-arquivos" }).success).toBe(false);
    expect(pedidoDeExecucao.safeParse({ ...EXEMPLOS.pedido, prioridade: 1 }).success).toBe(false);
    expect(DADOS_DOS_JOBS["aplicar-ciclos"].safeParse({ empresaId: "x" }).success).toBe(false);
  });
});
