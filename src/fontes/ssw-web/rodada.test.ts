import { describe, expect, it } from "vitest";

import { type ConfiguracaoSswWeb } from "./parametros";
import { type NavegadorSswWeb, rodadaSswWeb, type SessaoSswWeb } from "./rodada";

const config: ConfiguracaoSswWeb = {
  dominio: "FRT",
  cpf: "12345678901",
  usuario: "robo",
  senha: "s",
  matriz: "MTZ",
  unidades038: ["ARA", "CAP"],
  unidades038SoComDados: ["GDR", "COU"],
  unidades050: [],
};
// 13:05 UTC = 10:05 em Brasília
const AGORA = new Date("2026-11-11T13:05:00Z");
const texto = (s: string) => new TextEncoder().encode(s);

/** Sessão falsa que anota cada chamada; `falhar` derruba as chamadas com esses rótulos. */
function sessaoFalsa(falhar: string[] = [], prontosNaFila = ["455", "930"]) {
  const chamadas: string[] = [];
  let fechada = false;
  const passo = <T>(rotulo: string, valor: T): Promise<T> => {
    chamadas.push(rotulo);
    return falhar.includes(rotulo)
      ? Promise.reject(new Error(`${rotulo} quebrou\ndetalhe`))
      : Promise.resolve(valor);
  };
  const sessao: SessaoSswWeb = {
    marcaDaFila: () => passo("marca", 41),
    dispararNaFila: (opcao, dia) => passo(`disparar ${opcao} ${dia}`, undefined),
    coletarDaFila: (marca, opcoes) =>
      passo(
        `coletar ${marca} ${opcoes.join(",")}`,
        new Map(prontosNaFila.map((o) => [o, texto(o)])),
      ),
    baixar036: (dia) => passo(`036 ${dia}`, texto("036")),
    baixar306: (dia) => passo(`306 ${dia}`, texto("306")),
    // GDR volta só com cabeçalho e rodapé; o resto tem linha de dado ("2;").
    baixar038: (u) => passo(`038 ${u}`, texto(u === "GDR" ? "0;T\r\n1;C\r\n9;R" : "1;C\r\n2;x")),
    texto050: (u, dia, busca) => passo(`050 ${u} ${dia} ${busca}`, ""),
    fechar: () => {
      fechada = true;
      return Promise.resolve();
    },
  };
  const navegador: NavegadorSswWeb = { entrar: () => Promise.resolve(sessao) };
  return { navegador, chamadas, fechada: () => fechada };
}

describe("rodada no SSW web", () => {
  it("baixa na ordem do script, com os nomes da recepção e a hora de Brasília", async () => {
    const f = sessaoFalsa();
    const r = await rodadaSswWeb(f.navegador, config, AGORA);
    expect(f.chamadas).toEqual([
      "marca",
      "disparar 455 111126",
      "disparar 930 111126",
      "036 111126",
      "306 111126",
      "038 ARA",
      "038 CAP",
      "coletar 41 455,930",
      "038 GDR",
      "038 COU",
    ]);
    expect(r.arquivos.map((a) => a.nome)).toEqual([
      "036_romaneios_2026-11-11_1005.csv",
      "306_sswmobile_2026-11-11_1005.csv",
      "038_pendentes_ARA_2026-11-11_1005.csv",
      "038_pendentes_CAP_2026-11-11_1005.csv",
      "455_csv_e_2026-11-11_1005.csv",
      "930_ocorrencias_2026-11-11_1005.csv",
      "038_pendentes_COU_2026-11-11_1005.csv",
    ]);
    expect(r.descartados).toEqual(["038/GDR"]);
    expect(r.falhas).toEqual([]);
    expect(f.fechada()).toBe(true);
  });

  it("retroativo: pede o dia passado, carimbo <dia>_2359 e sem o 038", async () => {
    const f = sessaoFalsa();
    const r = await rodadaSswWeb(f.navegador, config, AGORA, "2026-11-09");
    expect(f.chamadas).toEqual([
      "marca",
      "disparar 455 091126",
      "disparar 930 091126",
      "036 091126",
      "306 091126",
      "coletar 41 455,930",
    ]);
    expect(r.arquivos.map((a) => a.nome)).toEqual([
      "036_romaneios_2026-11-09_2359.csv",
      "306_sswmobile_2026-11-09_2359.csv",
      "455_csv_e_2026-11-09_2359.csv",
      "930_ocorrencias_2026-11-09_2359.csv",
    ]);
  });

  it("falha de um relatório não derruba os outros; o que não liberou na fila vira falha", async () => {
    const f = sessaoFalsa(["036 111126", "disparar 930 111126"], []);
    const r = await rodadaSswWeb(f.navegador, config, AGORA);
    expect(f.chamadas).toContain("coletar 41 455");
    expect(r.falhas).toEqual([
      "930 (disparo): disparar 930 111126 quebrou",
      "036: 036 111126 quebrou",
      "455: não liberou na fila a tempo",
    ]);
    expect(r.arquivos.map((a) => a.nome.slice(0, 3))).toEqual(["306", "038", "038", "038"]);
  });

  it("sem a marca da fila não dispara o 455 nem o 930", async () => {
    const f = sessaoFalsa(["marca"]);
    const r = await rodadaSswWeb(f.navegador, config, AGORA);
    expect(f.chamadas.some((c) => c.startsWith("disparar") || c.startsWith("coletar"))).toBe(false);
    expect(r.falhas).toEqual(["156 (marca da fila): marca quebrou"]);
  });

  it("050: as duas buscas de cada filial num arquivo só; filial que falha derruba o 050", async () => {
    const com050 = {
      ...config,
      unidades038: [],
      unidades038SoComDados: [],
      unidades050: ["ARA", "CAP"],
    };
    const ok = sessaoFalsa();
    const r = await rodadaSswWeb(ok.navegador, com050, AGORA);
    expect(ok.chamadas.filter((c) => c.startsWith("050"))).toEqual([
      "050 ARA 111126 cadastradas",
      "050 ARA 111126 coletadas",
      "050 CAP 111126 cadastradas",
      "050 CAP 111126 coletadas",
    ]);
    expect(r.arquivos.at(-1)?.nome).toBe("050_coletas_2026-11-11_1005.csv");

    const quebra = sessaoFalsa(["050 CAP 111126 coletadas"]);
    const r2 = await rodadaSswWeb(quebra.navegador, com050, AGORA);
    expect(r2.arquivos.some((a) => a.nome.startsWith("050"))).toBe(false);
    expect(r2.falhas).toEqual(["050: 050 CAP 111126 coletadas quebrou"]);
  });

  it("login recusado é erro da rodada inteira", async () => {
    const navegador: NavegadorSswWeb = {
      entrar: () => Promise.reject(new Error("login no SSW web recusado ou sem resposta")),
    };
    await expect(rodadaSswWeb(navegador, config, AGORA)).rejects.toThrow("login");
  });
});
