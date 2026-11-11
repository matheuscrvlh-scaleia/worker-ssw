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
import { r036 } from "../../testes/registros";
import { aplicarBloco, prepararFila } from "./aplicar";
import { aplicarCiclo, descartarCiclo, rodarCiclos } from "./ciclo";
import { decidirEmpresa } from "./empresa";
import { arquivosEstaveis, escolherArquivos, sincronizarFtp } from "./ftp";
import { sha256 } from "./linhas";
import { type ConexaoSftp, type EntradaSftp } from "./portas";
import { receberArquivo } from "./receber";

// Amostra anonimizada no layout do 930 (CNPJ e nomes fictícios).
const CAB = CABECALHO_930.join(";");
const linha930 = (cod: string, data: string, hora: string, entrega = "") =>
  `1;"CAP033214-5";"03/11/26";"1";"55001";"1";"12345";"";"FRT";"CAP";"${data}";"${hora}";"${data}";"${hora}";"usuario";"${cod}";"OCORRENCIA";"";"${entrega}";"";"";"";"11222333000181";"CLIENTE EXEMPLO LTDA"`;
const arquivo930 = (...linhas: string[]) => new TextEncoder().encode([CAB, ...linhas].join("\r\n"));
const NOME = "930_ocorrencias_2026-11-05_1000.csv";

function montar() {
  const s = estadoFalso();
  const fila = filaFalsa();
  const travas = travasFalsas();
  const enfileirador = enfileiradorFalso();
  const deps = {
    empresaId: EMPRESA,
    executar: executarFalso(s),
    fila,
    travas,
    enfileirador,
    agora: () => s.agora,
  };
  const receber = (bytes: Uint8Array, nome = NOME) =>
    receberArquivo(deps, { nome, bytes, sha256: sha256(bytes), tamanho: bytes.length, mtime: 1 });
  return { s, fila, travas, enfileirador, deps, receber };
}

describe("recepção de arquivo", () => {
  it("grava o 930 no ciclo do carimbo e ignora o mesmo arquivo de novo", async () => {
    const { s, receber } = montar();
    const bytes = arquivo930(
      linha930("85", "04/11/26", "08:00"),
      linha930("1", "04/11/26", "15:00"),
    );
    expect(await receber(bytes)).toMatchObject({
      ok: true,
      status: "importado",
      relatorio: "930",
      gravados: 2,
    });
    expect(s.ciclos.get("2026-11-05_1000")).toMatchObject({
      status: "importando",
      arquivosImportados: 1,
    });
    expect(s.linhas.map((l) => `${l.sigla}|${l.numero}`)).toEqual(["CAP|33214", "CAP|33214"]);
    expect(await receber(bytes)).toMatchObject({ ok: true, status: "ignorado" });
  });

  it("arquivo sem leitor vira erro no arquivo e no ciclo", async () => {
    const { s, receber } = montar();
    const r = await receber(new TextEncoder().encode("lixo;sem;cabecalho"));
    expect(r.ok).toBe(false);
    expect(s.arquivos.get(NOME)?.status).toBe("erro");
    expect(s.ciclos.get("2026-11-05_1000")?.status).toBe("erro");
  });

  it("050 vai para as coletas e fica registrado (Q39)", async () => {
    const { s, receber, enfileirador } = montar();
    const r = await receber(
      new TextEncoder().encode("UNIDADE;COLETA;TIPO;X\nCAP;1;NORMAL;"),
      "050_coletas_2026-11-05_1000.csv",
    );
    expect(r).toMatchObject({ ok: true, status: "coletas" });
    expect(enfileirador.jobs[0]?.nome).toBe("importar-coletas-050");
    expect(s.arquivos.get("050_coletas_2026-11-05_1000.csv")?.relatorio).toBe("050");
  });
});

describe("aplicação em blocos", () => {
  it("cria o CT-e pela sigla+número, grava ocorrências e marca as linhas aplicadas", async () => {
    const { s, receber, deps, fila, enfileirador } = montar();
    await receber(
      arquivo930(linha930("85", "04/11/26", "08:00"), linha930("1", "04/11/26", "15:00")),
    );
    const r = await aplicarBloco(deps, { dryRun: false, limite: 4000, offset: 0, usuarioId: null });
    expect(r.totais).toMatchObject({ inserir: 1, ocorrencias: 2 });
    expect(s.ctes[0]).toMatchObject({
      sigla: "CAP",
      numero: "33214",
      dataEmissao: "2026-11-03",
      filial: "CAP",
    });
    expect(s.ctes[0]?.dataEntregaRealizada).toEqual(new Date("2026-11-04T18:00:00Z"));
    expect(s.ctes[0]?.ocorrEfetivaCodigoNum).toBe(1);
    expect(s.linhas.every((l) => l.aplicadoEm !== null)).toBe(true);
    expect(fila.itens).toEqual([]);
    expect(enfileirador.jobs.some((j) => j.nome === "projecoes-romaneio")).toBe(true);
    expect(s.aplicacoes[0]?.status).toBe("concluido");
    expect(s.auditoria).toContain("aplicar");
  });

  it("simulação não grava nada", async () => {
    const { s, receber, deps } = montar();
    await receber(arquivo930(linha930("1", "04/11/26", "15:00")));
    const r = await aplicarBloco(deps, { dryRun: true, limite: 4000, offset: 0, usuarioId: null });
    expect(r.totais.inserir).toBe(1);
    expect(s.ctes).toHaveLength(0);
    expect(s.linhas[0]?.aplicadoEm).toBeNull();
  });

  it("estorno 86 depois da baixa: apaga a ocorrência e tira a entrega (§11 caso 6)", async () => {
    const { s, receber, deps } = montar();
    await receber(arquivo930(linha930("1", "04/11/26", "10:00")));
    await aplicarBloco(deps, { dryRun: false, limite: 4000, offset: 0, usuarioId: null });
    expect(s.ctes[0]?.dataEntregaRealizada).not.toBeNull();
    await receber(
      arquivo930(linha930("1", "04/11/26", "10:00"), linha930("86", "04/11/26", "11:00")),
      "930_ocorrencias_2026-11-05_1030.csv",
    );
    await prepararFila(deps);
    await aplicarBloco(deps, { dryRun: false, limite: 4000, offset: 0, usuarioId: null });
    expect(s.ctes[0]?.dataEntregaRealizada).toBeNull();
    expect(s.ocorrencias.map((o) => o.codigo)).toEqual([86]);
  });

  it("status atual só é refeito no CT-e que ganhou ocorrência (gatilho de hoje)", async () => {
    const { s, receber, deps } = montar();
    const aplicar = async (nome: string, ...linhas: string[]) => {
      await receber(arquivo930(...linhas), nome);
      await prepararFila(deps);
      await aplicarBloco(deps, { dryRun: false, limite: 4000, offset: 0, usuarioId: null });
    };
    await aplicar(NOME, linha930("85", "04/11/26", "08:00"));
    const cte = s.ctes[0];
    if (!cte) throw new Error("esperava o CT-e criado");
    cte.statusAtual = "CANCELADO"; // escrito pelo XML de cancelamento
    // A mesma ocorrência de novo não entra (já existe): o status escrito fica.
    await aplicar("930_ocorrencias_2026-11-05_1030.csv", linha930("85", "04/11/26", "08:00"));
    expect(s.ctes[0]?.statusAtual).toBe("CANCELADO");
    await aplicar("930_ocorrencias_2026-11-05_1100.csv", linha930("99", "04/11/26", "09:00"));
    expect(s.ctes[0]?.statusAtual).toBe("OCORRENCIA");
  });

  it("fila incremental: só entra chave com linha pendente", async () => {
    const { receber, deps, fila } = montar();
    await receber(arquivo930(linha930("1", "04/11/26", "10:00")));
    expect(await prepararFila(deps)).toMatchObject({ modo: "completa", enfileirados: 1 });
    await aplicarBloco(deps, { dryRun: false, limite: 4000, offset: 0, usuarioId: null });
    expect(await prepararFila(deps)).toMatchObject({ modo: "incremental", enfileirados: 0 });
    expect(fila.itens).toEqual([]);
  });
});

describe("ciclo automático", () => {
  it("aplica o ciclo e fecha; com a trava ocupada devolve ja_rodando", async () => {
    const { s, receber, deps, travas } = montar();
    await receber(arquivo930(linha930("1", "04/11/26", "10:00")));
    const r = await rodarCiclos(deps);
    expect(r.resultados[0]).toMatchObject({ status: "aplicado" });
    expect(s.ciclos.get("2026-11-05_1000")?.status).toBe("aplicado");
    travas.ocupadas.add(`ssw_aplicar_ciclo:${EMPRESA}`);
    expect((await rodarCiclos(deps)).status).toBe("ja_rodando");
  });

  it("fila vazia: não chama a aplicação (§11 caso 14)", async () => {
    const { s, deps } = montar();
    s.ciclos.set("c1", {
      cicloChave: "c1",
      status: "aplicando",
      motivo: null,
      faltantes: [],
      totais: { _fila_pronta: true },
      arquivosImportados: 1,
      linhasImportadas: 0,
      primeiroArquivoEm: s.agora,
      ultimoArquivoEm: s.agora,
      fechadoEm: null,
      aplicadoEm: null,
    });
    const c = s.ciclos.get("c1");
    if (!c) throw new Error("ciclo");
    expect((await aplicarCiclo(deps, c)).status).toBe("aplicado");
    expect(s.aplicacoes).toHaveLength(0);
  });

  it("descartar apaga as linhas do ciclo e avisa as projeções; ciclo aplicado não descarta", async () => {
    const { s, receber, deps, enfileirador } = montar();
    await receber(arquivo930(linha930("1", "04/11/26", "10:00")));
    const lote = s.linhas[0]?.loteId ?? "";
    s.linhas.push({
      ...(s.linhas[0] as (typeof s.linhas)[number]),
      id: 99,
      relatorio: "036",
      hash: "h036",
      sigla: "CAP",
      numero: "123",
      dados: r036({ ctrc: "CAP000123-4", romaneio: "R9", data_emissao: "2026-11-05" }),
      loteId: lote,
    });
    await descartarCiclo(deps, "2026-11-05_1000", "teste");
    expect(s.linhas).toHaveLength(0);
    expect(s.ciclos.get("2026-11-05_1000")?.status).toBe("descartado");
    // Só a linha do 036 alimenta as projeções; a do 930 não gera aviso.
    expect(enfileirador.jobs).toEqual([
      {
        nome: "projecoes-romaneio",
        dados: {
          empresaId: deps.empresaId,
          chaves: [{ sigla: "CAP", numero: "123" }],
          descartadas: [
            {
              sigla: "CAP",
              numero: "123",
              relatorios: ["036"],
              romaneios: ["R9"],
              dias: ["2026-11-05"],
            },
          ],
        },
      },
    ]);
    s.ciclos.set("x", {
      ...(s.ciclos.get("2026-11-05_1000") as NonNullable<ReturnType<typeof s.ciclos.get>>),
      cicloChave: "x",
      status: "aplicado",
      aplicadoEm: s.agora,
    });
    await expect(descartarCiclo(deps, "x", "teste")).rejects.toThrow(/já foi aplicado/);
  });
});

describe("FTP", () => {
  const e = (nome: string, tamanho = 10, mtime = 1): EntradaSftp => ({
    nome,
    tamanho,
    mtime,
    tipo: "arquivo",
  });

  it("arquivo que muda nos 20 s não entra (§11 caso 18)", () => {
    expect(
      arquivosEstaveis([e("a.csv"), e("b.csv")], [e("a.csv"), e("b.csv", 20)]).map((a) => a.nome),
    ).toEqual(["a.csv"]);
  });

  it("rodízio por tipo, até 24, grandes por último", () => {
    const lista = [
      ...Array.from({ length: 30 }, (_, i) => e(`930_x_${String(i).padStart(2, "0")}.csv`)),
      e("455_csv_grande.csv", 5_000_000),
      e("038_p_ARA.csv"),
    ];
    const escolhidos = escolherArquivos(lista);
    expect(escolhidos).toHaveLength(24);
    expect(escolhidos.at(-1)?.nome).toBe("455_csv_grande.csv");
    expect(escolhidos.some((a) => a.nome === "038_p_ARA.csv")).toBe(true);
  });

  it("importa e move para importados/<dia SP>; pausa respeitada fora do manual", async () => {
    const { s, deps } = montar();
    const arquivos = new Map<string, Uint8Array>([
      ["/arquivos_import/" + NOME, arquivo930(linha930("1", "04/11/26", "10:00"))],
    ]);
    const conexao: ConexaoSftp = {
      existe: (c) =>
        Promise.resolve(c === "/arquivos_import" || c === "/importados" || arquivos.has(c)),
      listar: (p) =>
        Promise.resolve(
          [...arquivos.entries()]
            .filter(([c]) => c.startsWith(`${p}/`) && !c.slice(p.length + 1).includes("/"))
            .map(([c, b]) => e(c.slice(p.length + 1), b.length)),
        ),
      baixar: (c) => Promise.resolve(arquivos.get(c) ?? new Uint8Array()),
      enviar: (b, c) => Promise.resolve(void arquivos.set(c, b)),
      renomear: (de, para) => {
        const b = arquivos.get(de);
        if (b) arquivos.set(para, b);
        arquivos.delete(de);
        return Promise.resolve();
      },
      apagar: (c) => Promise.resolve(void arquivos.delete(c)),
      criarPasta: () => Promise.resolve(),
      apagarPasta: () => Promise.resolve(),
      encerrar: () => Promise.resolve(),
    };
    const progresso: string[] = [];
    const ftp = {
      ...deps,
      sftp: { conectar: () => Promise.resolve(conexao) },
      credenciais: {
        sftp: () =>
          Promise.resolve({
            host: "h",
            porta: 22,
            usuario: "u",
            senha: "s",
            impressaoDigital: "SHA256:teste",
            relatoriosPath: "/arquivos_import",
            importadosPath: "/importados",
          }),
      },
      progressos: {
        gravar: (_e: string, p: { fase?: string }) => {
          if (p.fase) progresso.push(p.fase);
          return Promise.resolve();
        },
        ler: () => Promise.resolve(null),
        limpar: () => Promise.resolve(),
      },
      relogio: { agora: () => s.agora, esperar: () => Promise.resolve() },
    };
    s.configuracoes.set("ftp_sync_ativo", "false");
    expect((await sincronizarFtp(ftp, { manual: false, retroativo: false })).status).toBe(
      "pausado",
    );
    const r = await sincronizarFtp(ftp, { manual: true, retroativo: false });
    expect(r).toMatchObject({ status: "ok", mensagem: "1 movido(s), 0 com erro" });
    expect([...arquivos.keys()]).toEqual([`/importados/2026-11-05/${NOME}`]);
    expect(s.ctes).toHaveLength(1);
    expect(progresso.at(-1)).toBe("concluido");
  });
});

describe("empresa da ingestão (§0.1)", () => {
  const fr = {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "fr",
    nome: "FR",
    status: "ativa",
    integracoesAtivas: ["sftp"],
  };
  it("pelo slug, sem empresa com uma só elegível, e os erros", () => {
    expect(decidirEmpresa("FR", "sftp", [fr])).toMatchObject({ ok: true });
    expect(decidirEmpresa(null, "sftp", [fr])).toMatchObject({ ok: true });
    expect(decidirEmpresa("x", "sftp", [fr])).toMatchObject({
      status: 404,
      motivo: "empresa_desconhecida",
    });
    expect(decidirEmpresa("fr", "xml_cte", [fr])).toMatchObject({ status: 409 });
    expect(decidirEmpresa(null, "sftp", [fr, { ...fr, id: "2", slug: "b" }])).toMatchObject({
      status: 400,
    });
    expect(decidirEmpresa("fr", "sftp", [{ ...fr, status: "suspensa" }])).toMatchObject({
      status: 403,
    });
  });
});
