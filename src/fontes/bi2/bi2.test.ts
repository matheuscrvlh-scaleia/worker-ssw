import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";

import { BancoFalso, cteGravado, EMPRESA } from "../../testes/banco-falso";
import { type Cofre } from "../comum/integracao";
import { lerCsvBi2, normalizarDominioSsw, urlDoRelatorio } from "./cliente";
import { criarJobBi2_0017 } from "./job";
import { lerLinhas0017 } from "./relatorio-0017";

const log = pino({ level: "silent" });
const cofre: Cofre = { decifrar: () => "token-bi2" };

const CSV = [
  "0;FR TRANSPORTES;CLIENTE;09/11/2026",
  "1;CTRC;DATA AUTORIZACAO;DATA PREVENTR;DATA ENTREGA;PERFORMANCE;RESP CLIENTE",
  "3;CAP033214-5;01/11/2026;05/11/2026 00:00;04/11/2026 15:00;0;N",
  "3;CAP033215-1;02/11/26;06/11/2026 00:00;05/11/2026 10:00;1;S",
  "3;CAP033216-8;;06/11/2026 00:00;05/11/2026 10:00;1;N",
  "3;;01/11/2026;;;;",
].join("\r\n");

function latin1(texto: string): ArrayBuffer {
  const bytes = Uint8Array.from({ length: texto.length }, (_, i) => texto.charCodeAt(i));
  return bytes.buffer;
}

function buscarFalso(respostas: Record<string, { status: number; corpo: string }>) {
  const urls: string[] = [];
  const buscar: typeof fetch = (entrada) => {
    const url =
      typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    urls.push(url);
    const data = /data=(\d+)/.exec(url)?.[1] ?? "";
    const r = respostas[data] ?? { status: 404, corpo: "nao encontrado" };
    return Promise.resolve(new Response(latin1(r.corpo), { status: r.status }));
  };
  return { buscar, urls };
}

describe("cliente e CSV do BI2", () => {
  it("URL por domínio da empresa e data do fechamento", () => {
    expect(urlDoRelatorio("frt", "cliente", "17", "2026-11-09")).toBe(
      "https://ssw.inf.br/api/bi2/FRT/cliente?codigo=17&data=20261109",
    );
    expect(() => normalizarDominioSsw(null)).toThrow("Domínio SSW da empresa não configurado");
    expect(() => normalizarDominioSsw("fr-t")).toThrow('Domínio SSW inválido: "FR-T".');
  });

  it("CSV: cabeçalho pela linha 1, dado nas linhas 2/3, bruto sem vazios; '9' = vazio", () => {
    const csv = lerCsvBi2(CSV);
    expect(csv.vazio).toBe(false);
    expect(csv.linhas).toHaveLength(4);
    expect(csv.linhas[0]?.valor("ctrc")).toBe("CAP033214-5");
    expect(csv.linhas[3]?.bruto).toEqual({ "DATA AUTORIZACAO": "01/11/2026" });
    expect(lerCsvBi2("9\n").vazio).toBe(true);
    expect(lerCsvBi2("").vazio).toBe(true);
  });

  it("0017: número sem DV, emissão pela autorização (ano de 2 dígitos = 20aa), linha sem número sai", () => {
    const linhas = lerLinhas0017(lerCsvBi2(CSV));
    expect(linhas.map((l) => [l.numero, l.dataEmissao, l.dataPrevistaEntrega])).toEqual([
      ["33214", "2026-11-01", "2026-11-05"],
      ["33215", "2026-11-02", "2026-11-06"],
      ["33216", null, "2026-11-06"],
    ]);
    expect(linhas[0]?.dataEntregaRealizada?.toISOString()).toBe("2026-11-04T18:00:00.000Z");
  });
});

describe("job bi2-0017", () => {
  let banco: BancoFalso;
  const agora = () => new Date("2026-11-10T15:00:00Z");

  beforeEach(() => {
    banco = new BancoFalso();
    banco.integracoes.set("ssw_bi2", {
      ativo: true,
      parametros: {},
      segredo: { cifrado: "x", versaoChave: 1 },
      dominioSswDaEmpresa: "FRT",
    });
  });

  async function rodar(dados: Record<string, unknown>, buscar: typeof fetch, c: Cofre = cofre) {
    const job = criarJobBi2_0017({ buscar, cofre: c });
    const parsed = job.dados.parse({ empresaId: EMPRESA, ...dados });
    return job.processar(
      {
        executar: (fn) =>
          banco.executar({ empresaId: EMPRESA, usuarioId: null, plataforma: false }, fn),
        empresaId: EMPRESA,
        log,
        agora,
      },
      parsed,
    );
  }

  it("CT-e em andamento não muda; entregue ganha a previsão nova e o prazo; bruto e log gravados", async () => {
    const emAndamento = cteGravado({ numero: "33214", dataEmissao: "2026-11-01" });
    const entregue = cteGravado({
      numero: "33215",
      dataEmissao: "2026-11-02",
      dataEntregaRealizada: new Date("2026-11-05T13:00:00Z"),
      dataPrevistaEntrega: "2026-11-04",
      prazoEntrega: "2026-11-04",
      prazoFonte: "ssw_038",
      camposSsw: ["data_prevista_entrega", "data_entrega_realizada"],
    });
    banco.ctes.push(emAndamento, entregue);
    const { buscar } = buscarFalso({ "20261109": { status: 200, corpo: CSV } });
    await rodar({ data: "2026-11-09" }, buscar);

    expect(banco.ctes.find((c) => c.id === emAndamento.id)).toEqual(emAndamento);
    const depois = banco.ctes.find((c) => c.id === entregue.id);
    expect(depois).toMatchObject({
      dataPrevistaEntrega: "2026-11-06",
      prazoEntrega: "2026-11-06",
      prazoFonte: "bi2",
      dataEntregaRealizada: new Date("2026-11-05T13:00:00Z"),
    });
    expect(banco.trocas).toEqual([
      { cteId: entregue.id, dataAnterior: "2026-11-04", dataNova: "2026-11-06", fonte: "bi2" },
    ]);
    expect([...banco.bruto.keys()].sort()).toEqual(["33214", "33215", "33216"]);
    expect(banco.sincronizacoes).toMatchObject([
      {
        codigoRelatorio: "17",
        dataAlvo: "2026-11-09",
        modo: "manual",
        status: "ok",
        totalLinhas: 3,
        atualizados: 2,
        erro: "ignorados_sem_autorizacao=1",
      },
    ]);
  });

  it("contínuo: hoje e 2 dias para trás; 404 de hoje e de segunda = vazio; 500 = erro", async () => {
    const { buscar, urls } = buscarFalso({ "20261108": { status: 500, corpo: "error code: 502" } });
    await rodar({ modo: "cron_continuo", lookback: 2 }, buscar);
    expect(urls.map((u) => /data=(\d+)/.exec(u)?.[1])).toEqual([
      "20261110",
      "20261109",
      "20261108",
    ]);
    expect(banco.sincronizacoes.map((s) => [s.dataAlvo, s.status, s.erro])).toEqual([
      ["2026-11-10", "vazio", null],
      ["2026-11-09", "vazio", null],
      ["2026-11-08", "erro", "HTTP 500: error code: 502"],
    ]);
  });

  it("sem token: registra o erro sem chamar o SSW; integração desligada não faz nada", async () => {
    const { buscar, urls } = buscarFalso({});
    await rodar({ data: "2026-11-05" }, buscar, { decifrar: () => null });
    expect(urls).toEqual([]);
    expect(banco.sincronizacoes[0]).toMatchObject({
      status: "erro",
      erro: "Token do BI2 não configurado para esta empresa",
    });

    banco.integracoes.clear();
    expect(await rodar({ data: "2026-11-05" }, buscar)).toEqual({ ok: true, ignorado: true });
  });
});
