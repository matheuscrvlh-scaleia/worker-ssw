import { describe, expect, it } from "vitest";

import {
  type EmpresaDoWebhook,
  type EventoRecebido,
  LIMITE_DA_QUARENTENA_BYTES,
  LIMITE_DIARIO_DA_QUARENTENA,
  receberWebhook,
} from "./recepcao";

const SEGREDO = "x".repeat(40);
const EVENTO = JSON.stringify({
  cte: { numeroCTe: "123456" },
  ocorrencia: { codigo: "1", dataHoraEvento: "09-11-2026 10:30:00" },
  cnpjTransportadora: "11222333000144",
});

function empresa(dados: Partial<EmpresaDoWebhook> = {}): EmpresaDoWebhook {
  return {
    id: "e1",
    slug: "fr",
    nome: "FR",
    status: "ativa",
    integracaoAtiva: true,
    parametros: {},
    segredo: { cifrado: "c", versaoChave: 1 },
    ...dados,
  };
}

/** O segredo "decifrado" é o próprio texto em `cifrado`, quando diferente de "c". */
function montar(empresas: EmpresaDoWebhook[], opcoes = { quarentena: 0, falhasPermitidas: 1000 }) {
  const eventos: EventoRecebido[] = [];
  const enfileirados: unknown[] = [];
  let falhas = 0;
  const portas = {
    quarentenaDesde: () => Promise.resolve(opcoes.quarentena),
    falhaPermitida: () => Promise.resolve(++falhas <= opcoes.falhasPermitidas),
    empresas: () => Promise.resolve(empresas),
    segredo: (e: EmpresaDoWebhook) =>
      e.segredo === null ? null : e.segredo.cifrado === "c" ? SEGREDO : e.segredo.cifrado,
    registrarEvento: (e: EventoRecebido) => {
      eventos.push(e);
      return Promise.resolve(`ev${eventos.length}`);
    },
    marcarEvento: () => Promise.resolve(),
    filas: {
      enfileirar: (_job: string, dados: unknown) => {
        enfileirados.push(dados);
        return Promise.resolve();
      },
    },
    agora: () => new Date("2026-11-10T12:00:00Z"),
    aleatorio: () => 0.5,
    avisar: () => undefined,
  };
  return { portas, eventos, enfileirados };
}

const req = (dados: Partial<Parameters<typeof receberWebhook>[1]> = {}) => ({
  corpoBruto: EVENTO,
  authorization: "",
  segredoNaQuery: "",
  empresaNaQuery: "",
  ip: "1.2.3.4",
  userAgent: null,
  ...dados,
});

describe("receberWebhook", () => {
  it("acha a empresa dona do segredo (Basic com o token na senha também vale)", async () => {
    const outra = empresa({
      id: "e0",
      slug: "outra",
      segredo: { cifrado: "y".repeat(40), versaoChave: 1 },
    });
    const { portas, eventos, enfileirados } = montar([outra, empresa()]);
    const basic = Buffer.from(`ssw:${SEGREDO}`).toString("base64");
    const r = await receberWebhook(portas, req({ authorization: `Basic ${basic}` }));
    expect(r.status).toBe(200);
    expect(eventos).toMatchObject([{ empresaId: "e1", autenticado: true, statusHttp: 200 }]);
    expect(enfileirados).toMatchObject([{ empresaId: "e1", eventoId: "ev1" }]);
  });

  it("segredo de empresa desligada não autentica e nada é gravado", async () => {
    const { portas, eventos } = montar([empresa({ integracaoAtiva: false })]);
    const r = await receberWebhook(portas, req({ authorization: `Bearer ${SEGREDO}` }));
    expect(r.status).toBe(401);
    expect(r.corpo[0]?.retorno).toMatchObject({ motivo: "token_incorreto" });
    expect(eventos).toEqual([]);
  });

  it("?empresa= desconhecida: 401; sem segredo cadastrado: 503 com evento", async () => {
    const { portas, eventos } = montar([empresa({ segredo: null })]);
    const desconhecida = await receberWebhook(portas, req({ empresaNaQuery: "xyz" }));
    expect(desconhecida.corpo[0]?.retorno).toMatchObject({ motivo: "empresa_desconhecida" });

    const semSegredo = await receberWebhook(
      portas,
      req({ empresaNaQuery: "FR", segredoNaQuery: SEGREDO }),
    );
    expect(semSegredo.status).toBe(503);
    expect(eventos).toMatchObject([{ empresaId: "e1", motivoRejeicao: "webhook_nao_configurado" }]);
  });

  it("?empresa= com token errado grava a recusa na empresa (ocorrência válida fica em quarentena)", async () => {
    const { portas, eventos } = montar([empresa()]);
    const r = await receberWebhook(portas, req({ empresaNaQuery: "fr", segredoNaQuery: "errado" }));
    expect(r.status).toBe(401);
    expect(eventos).toMatchObject([{ motivoRejeicao: "token_incorreto", autenticado: false }]);
    expect(eventos[0]?.payloadBruto).toEqual(JSON.parse(EVENTO));
    expect(JSON.stringify(eventos)).not.toContain("errado");
  });

  it("recusa que não pode ser o caso legítimo grava só metadados", async () => {
    const tokenErrado = { empresaNaQuery: "fr", segredoNaQuery: "errado" };
    const casos = [
      { dados: req({ ...tokenErrado, corpoBruto: "{nao é json" }), quarentena: 0 },
      { dados: req({ ...tokenErrado, corpoBruto: JSON.stringify({ x: 1 }) }), quarentena: 0 },
      {
        dados: req({
          ...tokenErrado,
          corpoBruto: JSON.stringify({
            ...(JSON.parse(EVENTO) as object),
            lixo: "x".repeat(LIMITE_DA_QUARENTENA_BYTES),
          }),
        }),
        quarentena: 0,
      },
      { dados: req(tokenErrado), quarentena: LIMITE_DIARIO_DA_QUARENTENA },
      { dados: req({ empresaNaQuery: "fr" }), quarentena: 0 },
    ];
    for (const { dados, quarentena } of casos) {
      const { portas, eventos } = montar([empresa({ parametros: {} })], {
        quarentena,
        falhasPermitidas: 1000,
      });
      await receberWebhook(portas, dados);
      expect(eventos).toHaveLength(1);
      expect(eventos[0]?.payloadBruto).toBeNull();
      expect(eventos[0]).toMatchObject({ ip: "1.2.3.4", autenticado: false });
    }
    const outroCnpj = montar([empresa({ parametros: { cnpjs_aceitos: ["99888777000166"] } })]);
    await receberWebhook(outroCnpj.portas, req(tokenErrado));
    expect(outroCnpj.eventos[0]?.payloadBruto).toBeNull();
  });

  it("falhas acima do limite do IP: 429 e nada gravado", async () => {
    const { portas, eventos } = montar([empresa()], { quarentena: 0, falhasPermitidas: 1 });
    const errado = req({ empresaNaQuery: "fr", segredoNaQuery: "errado" });
    expect((await receberWebhook(portas, errado)).status).toBe(401);
    expect((await receberWebhook(portas, errado)).status).toBe(429);
    expect((await receberWebhook(portas, req({ empresaNaQuery: "fr" }))).status).toBe(429);
    expect(eventos).toHaveLength(1);
    // Chamada autenticada não conta como falha.
    expect((await receberWebhook(portas, req({ segredoNaQuery: SEGREDO }))).status).toBe(200);
  });

  it("CNPJ fora da lista da empresa: 401 autenticado", async () => {
    const { portas, eventos, enfileirados } = montar([
      empresa({ parametros: { cnpjs_aceitos: ["99888777000166"] } }),
    ]);
    const r = await receberWebhook(portas, req({ segredoNaQuery: SEGREDO }));
    expect(r.status).toBe(401);
    expect(eventos).toMatchObject([{ motivoRejeicao: "cnpj_nao_autorizado", autenticado: true }]);
    expect(enfileirados).toEqual([]);
  });

  it("evento sem número: 400 gravado, sem fila", async () => {
    const { portas, eventos, enfileirados } = montar([empresa()]);
    const r = await receberWebhook(
      portas,
      req({ segredoNaQuery: SEGREDO, corpoBruto: JSON.stringify({ ocorrencia: { codigo: "1" } }) }),
    );
    expect(r.status).toBe(400);
    expect(eventos).toMatchObject([{ motivoRejeicao: "ctrc_obrigatorio" }]);
    expect(enfileirados).toEqual([]);
  });
});
