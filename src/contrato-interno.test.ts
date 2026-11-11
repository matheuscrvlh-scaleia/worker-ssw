import { describe, expect, it } from "vitest";

import {
  cicloDescartado,
  cicloRetomado,
  DADOS_DOS_JOBS,
  erroInterno,
  execucaoCriada,
  EXEMPLOS,
  JOBS_PEDIVEIS,
  LIMITE_DO_ARQUIVO_EM_BASE64,
  ok,
  pedidoDeAplicacao,
  pedidoDeDescarte,
  pedidoDeExecucao,
  pedidoDeFtpAtivo,
  pedidoDeRelatorio,
  pedidoDeXml,
  relatorioImportado,
  resultadoDaAplicacao,
  resultadoDoXml,
  situacaoDaEmpresa,
  situacaoDaExecucao,
  situacaoDoFtp,
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

  it("só os jobs da lista dos ADR 0012 e 0013; campo desconhecido é recusado", () => {
    expect(JOBS_PEDIVEIS).toEqual([
      "sincronizar-ftp",
      "sincronizar-ftp-retroativo",
      "baixar-relatorios-ssw",
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

  it("os exemplos das operações manuais valem pelo contrato", () => {
    expect(cicloRetomado.parse(EXEMPLOS.cicloRetomado)).toEqual(EXEMPLOS.cicloRetomado);
    expect(pedidoDeDescarte.parse(EXEMPLOS.descarte)).toEqual(EXEMPLOS.descarte);
    expect(cicloDescartado.parse(EXEMPLOS.cicloDescartado)).toEqual(EXEMPLOS.cicloDescartado);
    expect(pedidoDeRelatorio.parse(EXEMPLOS.relatorio)).toEqual(EXEMPLOS.relatorio);
    expect(relatorioImportado.parse(EXEMPLOS.relatorioImportado)).toEqual(
      EXEMPLOS.relatorioImportado,
    );
    expect(pedidoDeAplicacao.parse(EXEMPLOS.aplicacao)).toEqual(EXEMPLOS.aplicacao);
    expect(resultadoDaAplicacao.parse(EXEMPLOS.resultadoDaAplicacao)).toEqual(
      EXEMPLOS.resultadoDaAplicacao,
    );
    expect(situacaoDoFtp.parse(EXEMPLOS.ftp)).toEqual(EXEMPLOS.ftp);
    expect(pedidoDeFtpAtivo.parse(EXEMPLOS.ftpAtivo)).toEqual(EXEMPLOS.ftpAtivo);
    expect(ok.parse(EXEMPLOS.ok)).toEqual(EXEMPLOS.ok);
    expect(pedidoDeXml.parse(EXEMPLOS.xml)).toEqual(EXEMPLOS.xml);
    expect(resultadoDoXml.parse(EXEMPLOS.resultadoDoXml)).toEqual(EXEMPLOS.resultadoDoXml);
  });

  it("operações manuais: padrões, motivo curto, arquivo grande e campo desconhecido", () => {
    expect(pedidoDeAplicacao.parse({ simular: false })).toEqual({
      simular: false,
      limite: 4000,
      offset: 0,
    });
    expect(pedidoDeDescarte.parse({})).toEqual({});
    expect(pedidoDeDescarte.safeParse({ motivo: "x" }).success).toBe(false);
    const { aceitarDivergencia: _, ...semConfirmacao } = EXEMPLOS.relatorio;
    expect(pedidoDeRelatorio.parse(semConfirmacao).aceitarDivergencia).toBe(false);
    expect(pedidoDeRelatorio.safeParse({ ...EXEMPLOS.relatorio, relatorio: "050" }).success).toBe(
      false,
    );
    const grande = "A".repeat(LIMITE_DO_ARQUIVO_EM_BASE64 + 1);
    expect(pedidoDeXml.safeParse({ ...EXEMPLOS.xml, conteudoBase64: grande }).success).toBe(false);
    expect(pedidoDeXml.safeParse({ ...EXEMPLOS.xml, conteudoBase64: "" }).success).toBe(false);
    expect(pedidoDeFtpAtivo.safeParse({ ativo: true, motivo: "x" }).success).toBe(false);
  });
});
