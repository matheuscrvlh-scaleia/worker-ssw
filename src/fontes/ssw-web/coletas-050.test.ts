import { readFileSync } from "node:fs";
import { join } from "node:path";

import { lerRelatorio050 } from "@erp/domain/pickups/reader-050";
import { describe, expect, it } from "vitest";

import { converterColetas050, csvDasColetas050, juntarColetas } from "./coletas-050";

const impresso = readFileSync(
  join(__dirname, "../../domain/pickups/__fixtures__/report-050-sample.txt"),
  "latin1",
);
const ref = { ano: 2026, mes: 11, dia: 3 };

describe("050 impresso → CSV", () => {
  it("uma coleta por bloco, com o ano mais perto do dia pedido e o CEP com o zero da frente", () => {
    const coletas = converterColetas050(impresso, ref);
    expect(coletas).toHaveLength(4);
    expect(coletas[0]).toMatchObject({
      UNIDADE: "ARA",
      COLETA: "056168",
      TIPO: "NORMAL",
      DATA_LIMITE_INICIAL: "16/10/2026",
      REME_CNPJ: "11111111000191",
      REME_CEP: "26413030",
      DEST_CEP: "07140115",
      DATA_HORA_LIMITE: "16/10/2026 23:59",
      SITUACAO_ATUAL: "COLETADA",
      DATA_SITUACAO_ATUAL: "16/10/2026 09:40",
    });
    // Pedido em janeiro: o 16/10 é do ano anterior.
    expect(
      converterColetas050(impresso, { ano: 2027, mes: 1, dia: 5 })[0]?.DATA_LIMITE_INICIAL,
    ).toBe("16/10/2026");
  });

  it("o CSV gerado o leitor do FTP lê com as mesmas coletas do impresso", () => {
    const doImpresso = lerRelatorio050(impresso).coletas;
    const csv = new TextDecoder("iso-8859-1").decode(
      csvDasColetas050(converterColetas050(impresso, ref)),
    );
    expect(csv.split("\r\n")[0]?.startsWith("UNIDADE;COLETA;TIPO;")).toBe(true);
    const doCsv = lerRelatorio050(csv, "050_coletas_2026-11-03_1200.csv").coletas;
    const resumo = (c: (typeof doCsv)[number]) => [
      c.unidade,
      c.numero,
      c.remetenteCnpj,
      c.situacao,
    ];
    expect(doCsv.map(resumo)).toEqual(doImpresso.map(resumo));
  });

  it("junta as buscas sem repetir coleta e cita campo com ponto e vírgula", () => {
    const [a, b] = converterColetas050(impresso, ref);
    if (!a || !b) throw new Error("amostra sem coletas");
    const juntas = juntarColetas([[a, b], [{ ...a, OBS1: "outra" }]]);
    expect(juntas.map((c) => c.COLETA)).toEqual([a.COLETA, b.COLETA]);
    const csv = new TextDecoder("iso-8859-1").decode(csvDasColetas050([{ ...a, OBS1: 'x;"y"' }]));
    expect(csv).toContain(';"x;""y"""');
  });
});
