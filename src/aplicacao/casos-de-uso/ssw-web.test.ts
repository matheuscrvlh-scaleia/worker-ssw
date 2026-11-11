import { describe, expect, it } from "vitest";

import { CABECALHO_930 } from "../../fontes/relatorios";
import { EMPRESA } from "../../testes/cte";
import {
  enfileiradorFalso,
  estadoFalso,
  executarFalso,
  filaFalsa,
  travasFalsas,
} from "../../testes/falsos";
import { type BaixadosDoSswWeb, baixarRelatoriosSsw, travaDoSswWeb } from "./ssw-web";

// Amostra anonimizada no layout do 930 (CNPJ e nomes fictícios).
const linha930 = `1;"CAP033214-5";"03/11/26";"1";"55001";"1";"12345";"";"FRT";"CAP";"04/11/26";"08:00";"04/11/26";"08:00";"usuario";"85";"OCORRENCIA";"";"";"";"";"";"11222333000181";"CLIENTE EXEMPLO LTDA"`;
const arquivo930 = new TextEncoder().encode([CABECALHO_930.join(";"), linha930].join("\r\n"));
const NOME = "930_ocorrencias_2026-11-05_1000.csv";

function montar(baixados: BaixadosDoSswWeb) {
  const s = estadoFalso();
  const travas = travasFalsas();
  let chamadas = 0;
  const deps = {
    empresaId: EMPRESA,
    executar: executarFalso(s),
    fila: filaFalsa(),
    travas,
    enfileirador: enfileiradorFalso(),
    agora: () => s.agora,
    baixar: () => {
      chamadas++;
      return Promise.resolve(baixados);
    },
  };
  return { s, travas, deps, chamadas: () => chamadas };
}

describe("relatórios do SSW web na ingestão", () => {
  it("entrega à recepção do FTP (mesmo ciclo do carimbo) e roda a aplicação", async () => {
    const { s, travas, deps } = montar({
      arquivos: [{ nome: NOME, bytes: arquivo930 }],
      falhas: [],
      descartados: [],
    });
    expect(await baixarRelatoriosSsw(deps)).toEqual({
      status: "ok",
      mensagem: "1 importado(s), 0 repetido(s)",
      importados: 1,
      repetidos: 0,
      falhas: [],
    });
    expect(s.arquivos.get(NOME)?.status).toBe("importado");
    expect(s.ciclos.has("2026-11-05_1000")).toBe(true);
    expect(s.linhas).toHaveLength(1);
    expect(s.ocorrencias).toHaveLength(1); // o ciclo aplicou a linha
    expect(travas.ocupadas.size).toBe(0);
    // O mesmo arquivo de novo é repetido, não erro.
    expect(await baixarRelatoriosSsw(deps)).toMatchObject({ status: "ok", repetidos: 1 });
  });

  it("parcial quando parte falhou no SSW ou na recepção", async () => {
    const { deps } = montar({
      arquivos: [
        { nome: NOME, bytes: arquivo930 },
        { nome: "306_sswmobile_2026-11-05_1000.csv", bytes: new TextEncoder().encode("lixo") },
      ],
      falhas: ["036: tela não abriu"],
      descartados: [],
    });
    const r = await baixarRelatoriosSsw(deps);
    expect(r.status).toBe("parcial");
    expect(r.falhas[0]).toBe("036: tela não abriu");
    expect(r.falhas[1]).toMatch(/^306_sswmobile_2026-11-05_1000\.csv: /);
  });

  it("nada importado é erro do job (aparece no Diagnóstico) e a trava é liberada", async () => {
    const { deps, travas } = montar({ arquivos: [], falhas: ["036: x"], descartados: [] });
    await expect(baixarRelatoriosSsw(deps)).rejects.toThrow(
      "Nenhum relatório do SSW web importado. 036: x",
    );
    expect(travas.ocupadas.size).toBe(0);
  });

  it("com outra rodada da empresa em andamento não abre o navegador", async () => {
    const { deps, travas, chamadas } = montar({ arquivos: [], falhas: [], descartados: [] });
    travas.ocupadas.add(travaDoSswWeb(EMPRESA));
    expect(await baixarRelatoriosSsw(deps)).toMatchObject({ status: "ja_rodando" });
    expect(chamadas()).toBe(0);
  });
});
