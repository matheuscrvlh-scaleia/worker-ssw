import { randomUUID } from "node:crypto";

import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";

import { BancoFalso, cteGravado, EMPRESA } from "../../testes/banco-falso";
import { jobWebhookSsw, processarEvento, SEM_VINCULO } from "./job";

const log = pino({ level: "silent" });
const agora = new Date("2026-11-05T12:00:00Z");

function corpo(cte: Record<string, unknown>, ocorrencia: Record<string, unknown> = {}) {
  return {
    cnpjTransportadora: "12345678000190",
    nf: {
      numeroNFe: 5501,
      serieNFe: "1",
      pedido: "",
      chaveNFe: "35261198765432000110550010000055011000055018",
    },
    cte: { numeroSSW: "0", ...cte },
    ocorrencia: {
      codigo: "85",
      descricao: "SAIDA PARA ENTREGA",
      dataHoraEvento: "05-11-2026 08:30:00",
      ...ocorrencia,
    },
  };
}

let banco: BancoFalso;

function evento(payload: unknown) {
  const id = randomUUID();
  banco.eventos.set(id, { payload, resultado: null });
  return id;
}

const processar = (id: string) =>
  banco.executar(
    { empresaId: EMPRESA, usuarioId: null, plataforma: false },
    ({ webhook, cteNucleo }) =>
      processarEvento(
        webhook,
        cteNucleo,
        { empresaId: EMPRESA, eventoId: id, protocolo: "prot0001" },
        agora,
      ),
  );

beforeEach(() => {
  banco = new BancoFalso();
});

describe("webhook SSW2181 — processamento", () => {
  it("casa por sigla + número, grava a ocorrência e recalcula o CT-e pelo núcleo", async () => {
    const cas = cteGravado({ sigla: "CAS", numero: "33214", dataEmissao: "2026-11-04" });
    const cap = cteGravado({ sigla: "CAP", numero: "33214", dataEmissao: "2026-03-01" });
    banco.ctes.push(cas, cap);
    const id = evento(corpo({ numeroCTe: "CAP033214-5" }));
    const r = await processar(id);

    expect(r).toMatchObject({ statusHttp: 200, cteId: cap.id, motivoRejeicao: null });
    expect(banco.ocorrencias).toMatchObject([
      { cteId: cap.id, codigo: 85, protocoloSsw: "prot0001", quarentena: false },
    ]);
    const depois = banco.ctes.find((c) => c.id === cap.id);
    expect(depois).toMatchObject({
      statusAtual: "SAIDA PARA ENTREGA",
      dataEmbarque: "2026-11-05",
      chaveNfe: "35261198765432000110550010000055011000055018",
      cnpjRemetente: "98765432000110",
      numeroNf: 5501,
    });
    expect(banco.eventos.get(id)?.resultado).toEqual(r);
  });

  it("sem sigla vale a série de emissão mais recente", async () => {
    const antigo = cteGravado({ sigla: "CAS", numero: "77123", dataEmissao: "2026-03-01" });
    const vigente = cteGravado({ sigla: "CAP", numero: "77123", dataEmissao: "2026-11-01" });
    banco.ctes.push(antigo, vigente);
    expect(await processar(evento(corpo({ numeroSSW: "77123" })))).toMatchObject({
      cteId: vigente.id,
    });
  });

  it("CT-e desconhecido com sigla é criado; sem sigla, só NF ou número = NF fica sem vínculo", async () => {
    const criado = await processar(evento(corpo({ numeroCTe: "CAP088001-1" })));
    expect(criado).toMatchObject({ statusHttp: 200 });
    expect(banco.ctes).toHaveLength(1);
    expect(banco.ctes[0]).toMatchObject({
      sigla: "CAP",
      numero: "88001",
      dataEmissao: "2026-11-05",
    });

    for (const cte of [{ numeroCTe: "88002" }, { numeroCTe: "" }, { numeroCTe: "CAP5501" }]) {
      expect(await processar(evento(corpo(cte)))).toMatchObject({
        statusHttp: 202,
        motivoRejeicao: SEM_VINCULO,
        cteId: null,
      });
    }
    expect(banco.ctes).toHaveLength(1);
  });

  it("emitido antes da data mínima não é criado (fica sem vínculo)", async () => {
    banco.contexto = {
      ...banco.contexto,
      config: { ...banco.contexto.config, dataMinimaEmissao: "2026-12-01" },
    };
    expect(await processar(evento(corpo({ numeroCTe: "CAP088001-1" })))).toMatchObject({
      statusHttp: 202,
      motivoRejeicao: "abaixo_da_data_minima",
    });
  });

  it("código sem cadastro entra pendente; 84 grava a filial pela cidade do complemento", async () => {
    banco.ctes.push(cteGravado({ dataEmissao: "2026-11-04" }));
    banco.apelidos.set("SAO JOAO DE MERITI", "SJM");
    await processar(
      evento(
        corpo(
          { numeroCTe: "CAP033214-5" },
          {
            codigo: "84",
            descricao: "CHEGADA NA UNIDADE",
            complemento: "Chegada na unidade SAO JOAO DE MERITI em 02/07/26, 01:14h.",
          },
        ),
      ),
    );
    await processar(evento(corpo({ numeroCTe: "CAP033214-5" }, { codigo: "42", descricao: "" })));
    expect(banco.ocorrencias.map((o) => [o.codigo, o.filial])).toEqual([
      [84, "SJM"],
      [42, null],
    ]);
    expect(banco.codigosCadastrados).toMatchObject([
      { codigo: 42, descricao: "Recebido via SSW", pendenteClassificacao: true },
    ]);
  });

  it("evento reenviado atualiza a mesma ocorrência", async () => {
    banco.ctes.push(cteGravado({ dataEmissao: "2026-11-04" }));
    const payload = corpo({ numeroCTe: "CAP033214-5" });
    await processar(evento(payload));
    await processar(evento(payload));
    expect(banco.ocorrencias).toHaveLength(1);
  });

  it("falha no banco marca o evento com erro e deixa o BullMQ tentar de novo", async () => {
    banco.ctes.push(cteGravado());
    const id = evento(corpo({ numeroCTe: "CAP033214-5" }));
    banco.falharCom = new Error("conexão caiu");
    await expect(
      jobWebhookSsw.processar(
        {
          executar: (fn) =>
            banco.executar({ empresaId: EMPRESA, usuarioId: null, plataforma: false }, fn),
          empresaId: EMPRESA,
          log,
          agora: () => agora,
        },
        { empresaId: EMPRESA, eventoId: id, protocolo: "p1" },
      ),
    ).rejects.toThrow("conexão caiu");
    expect(banco.eventos.get(id)?.resultado).toMatchObject({
      statusHttp: 500,
      motivoRejeicao: "erro_gravando_ocorrencia",
      erroProcessamento: "conexão caiu",
    });
  });

  it("evento sem token conferido nunca vira dado", async () => {
    const cte = cteGravado({ sigla: "CAP", numero: "33214" });
    banco.ctes.push(cte);
    const id = randomUUID();
    banco.eventos.set(id, {
      payload: corpo({ numeroCTe: "CAP033214-5" }),
      autenticado: false,
      resultado: null,
    });
    const r = await processar(id);
    expect(r).toMatchObject({ statusHttp: 401, motivoRejeicao: "token_incorreto" });
    expect(banco.ocorrencias).toEqual([]);
  });

  it("reaplica a lista de CNPJs aceitos da integração", async () => {
    banco.ctes.push(cteGravado({ sigla: "CAP", numero: "33214" }));
    banco.integracoes.set("ssw_webhook", {
      ativo: true,
      parametros: { cnpjs_aceitos: ["99888777000166"] },
      segredo: null,
      dominioSswDaEmpresa: null,
    });
    const r = await processar(evento(corpo({ numeroCTe: "CAP033214-5" })));
    expect(r).toMatchObject({ statusHttp: 401, motivoRejeicao: "cnpj_nao_autorizado" });
    expect(banco.ocorrencias).toEqual([]);
  });
});
