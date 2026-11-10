import { chaveDoCte } from "@erp/dominio/romaneio/projecoes";
import { linha036 } from "@erp/dominio/testes/romaneio";
import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { BancoFalso } from "../testes/banco-falso";
import { lerAlvo, reconstruirProjecoes } from "./reconstruir-projecoes";

const A = "0b9a2c3e-1d4f-4a5b-8c6d-7e8f9a0b1c2d";
const B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const log = pino({ level: "silent" });

describe("reconstruir-projecoes", () => {
  it("lê o alvo: uma empresa pelo id ou todas; o resto é uso errado", () => {
    expect(lerAlvo(["--empresa", A])).toEqual({ empresaId: A });
    expect(lerAlvo(["--todas"])).toBe("todas");
    expect(lerAlvo([])).toBeNull();
    expect(lerAlvo(["--empresa", "fr"])).toBeNull();
    expect(lerAlvo(["--todas", "--empresa", A])).toBeNull();
  });

  it("todas: lista as empresas pela Plataforma e reconstrói cada uma no contexto dela", async () => {
    const banco = new BancoFalso();
    banco.empresas = [
      { id: A, integracoes: [] },
      { id: B, integracoes: [] },
    ];
    const chave = { sigla: "CAP", numero: "38984" };
    banco.projecoes.chaves = [chave];
    banco.projecoes.linhas.set(chaveDoCte(chave), {
      l036: [linha036()],
      l306: [],
      l038: [],
      l455: [],
    });

    const resumos = await reconstruirProjecoes(banco.executar, log, "todas");

    expect(resumos.map((r) => r.empresaId)).toEqual([A, B]);
    expect(resumos[0]).toMatchObject({ ctes: 1 });
    expect(banco.contextos).toEqual([
      { empresaId: null, usuarioId: null, plataforma: true },
      { empresaId: A, usuarioId: null, plataforma: false },
      { empresaId: B, usuarioId: null, plataforma: false },
    ]);
  });

  it("uma empresa: não consulta a lista de empresas", async () => {
    const banco = new BancoFalso();
    await reconstruirProjecoes(banco.executar, log, { empresaId: A });
    expect(banco.contextos).toEqual([{ empresaId: A, usuarioId: null, plataforma: false }]);
  });
});
