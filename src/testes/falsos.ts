/** Dependências falsas (em memória) para testar os casos de uso sem banco, Redis nem SFTP. */
import { randomUUID } from "node:crypto";

import { CONFIGURACAO_PADRAO, type OcorrenciaDoCte } from "@erp/dominio/nucleo";
import { CATALOGO_FR } from "@erp/dominio/testes/nucleo";

import {
  type ArquivoRegistrado,
  type CicloRegistrado,
  type Enfileirador,
  type FilaDeAplicacao,
  type RepositorioIngestao,
  type SincronizacaoFtp,
  type Transacional,
  type Travas,
} from "../aplicacao/casos-de-uso/portas";
import { chaveDoCte, type CteDaIngestao, STATUS_CICLO_ABERTO } from "../aplicacao/regras";
import { EMPRESA } from "./cte";

interface LinhaFalsa {
  id: number;
  relatorio: string;
  loteId: string;
  arquivoId: string | null;
  hash: string;
  sigla: string | null;
  numero: string | null;
  dados: unknown;
  importadoEm: Date;
  aplicadoEm: Date | null;
}

export interface EstadoFalso {
  agora: Date;
  linhas: LinhaFalsa[];
  arquivos: Map<string, ArquivoRegistrado>;
  ciclos: Map<string, CicloRegistrado>;
  ctes: CteDaIngestao[];
  ocorrencias: (OcorrenciaDoCte & { cteId: string })[];
  codigosNovos: number[];
  aplicacoes: { id: string; status: string; erro: string | null }[];
  auditoria: string[];
  sincronizacoes: SincronizacaoFtp[];
  configuracoes: Map<string, string>;
  esperados: Awaited<ReturnType<RepositorioIngestao["relatoriosEsperados"]>>;
}

export function estadoFalso(agora = new Date("2026-11-05T13:00:00Z")): EstadoFalso {
  return {
    agora,
    linhas: [],
    arquivos: new Map(),
    ciclos: new Map(),
    ctes: [],
    ocorrencias: [],
    codigosNovos: [],
    aplicacoes: [],
    auditoria: [],
    sincronizacoes: [],
    configuracoes: new Map(),
    esperados: [],
  };
}

const naoUsado = () => Promise.reject(new Error("não usado neste teste"));

export function repositorioFalso(s: EstadoFalso): RepositorioIngestao {
  let seq = 0;
  const daChave = (chaves: readonly { sigla: string; numero: string }[]) =>
    new Set(chaves.map(chaveDoCte));
  const comChave = (l: LinhaFalsa) => l.sigla !== null && l.numero !== null;
  const r: RepositorioIngestao = {
    empresa: () =>
      Promise.resolve({ id: EMPRESA, nome: "FR", dominioSsw: "FRT", cnpj: "99888777000166" }),
    configuracoes: (chaves) =>
      Promise.resolve(new Map([...s.configuracoes].filter(([k]) => chaves.includes(k)))),
    arquivoPorNome: (nome) => Promise.resolve(s.arquivos.get(nome) ?? null),
    registrarArquivo: (a) => {
      const antes = s.arquivos.get(a.nomeArquivo);
      s.arquivos.set(a.nomeArquivo, {
        ...a,
        id: antes?.id ?? randomUUID(),
        vistoEm: s.agora,
        importadoEm: a.status === "importado" ? s.agora : null,
      });
      return Promise.resolve();
    },
    nomesDeArquivosRegistrados: () => Promise.resolve(new Set(s.arquivos.keys())),
    garantirCiclo: (c) => {
      if (!s.ciclos.has(c)) {
        s.ciclos.set(c, {
          cicloChave: c,
          status: "aberto",
          motivo: null,
          faltantes: [],
          totais: {},
          arquivosImportados: 0,
          linhasImportadas: 0,
          primeiroArquivoEm: s.agora,
          ultimoArquivoEm: s.agora,
          fechadoEm: null,
          aplicadoEm: null,
        });
      }
      return Promise.resolve();
    },
    ciclo: (c) => Promise.resolve(s.ciclos.get(c) ?? null),
    mudarCiclo: (c, m) => {
      const atual = s.ciclos.get(c);
      if (atual) {
        const { somarArquivos = 0, somarLinhas = 0, tocarUltimoArquivo, ...campos } = m;
        s.ciclos.set(c, {
          ...atual,
          ...campos,
          arquivosImportados: atual.arquivosImportados + somarArquivos,
          linhasImportadas: atual.linhasImportadas + somarLinhas,
          ultimoArquivoEm: tocarUltimoArquivo ? s.agora : atual.ultimoArquivoEm,
        });
      }
      return Promise.resolve();
    },
    ciclosAbertos: () =>
      Promise.resolve(
        [...s.ciclos.values()].filter((c) =>
          (STATUS_CICLO_ABERTO as readonly string[]).includes(c.status),
        ),
      ),
    fecharCiclosCobertos: (ate, agora) => {
      let n = 0;
      for (const c of s.ciclos.values()) {
        if (
          (STATUS_CICLO_ABERTO as readonly string[]).includes(c.status) &&
          c.ultimoArquivoEm <= ate
        ) {
          s.ciclos.set(c.cicloChave, { ...c, status: "aplicado", aplicadoEm: agora });
          n++;
        }
      }
      return Promise.resolve(n);
    },
    arquivosDoCiclo: (c) =>
      Promise.resolve([...s.arquivos.values()].filter((a) => a.cicloChave === c)),
    relatoriosEsperados: () => Promise.resolve(s.esperados),
    gravarLinhas: (relatorio, loteId, arquivoId, linhas) => {
      let n = 0;
      for (const l of linhas) {
        const existente = s.linhas.find((x) => x.relatorio === relatorio && x.hash === l.hash);
        if (existente && relatorio === "455csv") continue;
        if (existente) {
          Object.assign(existente, { loteId, arquivoId, importadoEm: s.agora, aplicadoEm: null });
        } else {
          s.linhas.push({
            id: ++seq,
            relatorio,
            loteId,
            arquivoId,
            hash: l.hash,
            sigla: l.sigla,
            numero: l.numero,
            dados: l.dados,
            importadoEm: s.agora,
            aplicadoEm: null,
          });
        }
        n++;
      }
      return Promise.resolve(n);
    },
    gravarErros: () => Promise.resolve(),
    linhasDasChaves: (relatorio, chaves) => {
      const quero = daChave(chaves);
      return Promise.resolve(
        s.linhas
          .filter(
            (l) => l.relatorio === relatorio && comChave(l) && quero.has(`${l.sigla}|${l.numero}`),
          )
          .map((l) => ({
            id: l.id,
            loteId: l.loteId,
            importadoEm: l.importadoEm,
            sigla: l.sigla ?? "",
            numero: l.numero ?? "",
            dados: l.dados,
          })),
      );
    },
    chavesPendentes: (relatorios, limite) => {
      const vistas = new Map<string, { sigla: string; numero: string }>();
      for (const l of s.linhas) {
        if (
          relatorios.includes(l.relatorio as never) &&
          l.aplicadoEm === null &&
          l.sigla &&
          l.numero
        ) {
          vistas.set(`${l.sigla}|${l.numero}`, { sigla: l.sigla, numero: l.numero });
        }
      }
      return Promise.resolve([...vistas.values()].slice(0, limite));
    },
    todasAsChaves: (relatorios) => {
      const vistas = new Map<string, { sigla: string; numero: string }>();
      for (const l of s.linhas) {
        if (relatorios.includes(l.relatorio as never) && l.sigla && l.numero) {
          vistas.set(`${l.sigla}|${l.numero}`, { sigla: l.sigla, numero: l.numero });
        }
      }
      return Promise.resolve([...vistas.values()]);
    },
    marcarAplicadas: (relatorios, chaves, agora) => {
      const quero = daChave(chaves);
      for (const l of s.linhas) {
        if (relatorios.includes(l.relatorio as never) && quero.has(`${l.sigla}|${l.numero}`)) {
          l.aplicadoEm ??= agora;
        }
      }
      return Promise.resolve();
    },
    linhasSemChave: () => Promise.resolve(0),
    chavesDesde: (relatorio, desde) => {
      const vistas = new Map<string, { sigla: string; numero: string }>();
      for (const l of s.linhas) {
        if (l.relatorio === relatorio && l.importadoEm >= desde && l.sigla && l.numero) {
          vistas.set(`${l.sigla}|${l.numero}`, { sigla: l.sigla, numero: l.numero });
        }
      }
      return Promise.resolve([...vistas.values()]);
    },
    cadastrosDoNucleo: () =>
      Promise.resolve({
        catalogo: CATALOGO_FR,
        filiais: [{ sigla: "CAP", cidade: "CAMPINAS", uf: "SP", propria: true }],
        regrasDePrazo: [],
        config: CONFIGURACAO_PADRAO,
        cnpjsProprios: ["99888777000166"],
        dominioSsw: "FRT",
      }),
    ctesDasChaves: (chaves) => {
      const quero = daChave(chaves);
      return Promise.resolve(s.ctes.filter((c) => quero.has(chaveDoCte(c))));
    },
    inserirCtes: (novos) => {
      const entraram = novos.filter((n) => !s.ctes.some((c) => chaveDoCte(c) === chaveDoCte(n)));
      s.ctes.push(...entraram);
      return Promise.resolve(entraram);
    },
    atualizarCte: (id, campos) => {
      const i = s.ctes.findIndex((c) => c.id === id);
      const atual = s.ctes[i];
      if (atual) s.ctes[i] = { ...atual, ...campos };
      return Promise.resolve();
    },
    registrarTrocaDePrevisao: () => Promise.resolve(),
    cteDaChave: (chave) => Promise.resolve(s.ctes.find((c) => c.chave === chave)?.id ?? null),
    ocorrenciasDosCtes: (ids) => {
      const m = new Map<string, OcorrenciaDoCte[]>();
      for (const o of s.ocorrencias)
        if (ids.includes(o.cteId)) m.set(o.cteId, [...(m.get(o.cteId) ?? []), o]);
      return Promise.resolve(m);
    },
    inserirCodigos: (c) => Promise.resolve(void s.codigosNovos.push(...c.map((x) => x.codigo))),
    inserirOcorrencias: (lista) => {
      let n = 0;
      for (const o of lista) {
        if (
          s.ocorrencias.some(
            (x) =>
              x.cteId === o.cteId &&
              x.codigo === o.codigo &&
              x.dataHora.getTime() === o.dataHora.getTime(),
          )
        )
          continue;
        s.ocorrencias.push({
          id: randomUUID(),
          cteId: o.cteId,
          codigo: o.codigo,
          descricao: o.descricao,
          dataHora: o.dataHora,
          filial: o.filial,
          origem: o.origem,
          quarentena: o.quarentena,
          criadoEm: s.agora,
        });
        n++;
      }
      return Promise.resolve(n);
    },
    apagarOcorrencia: (cteId, codigo, dataHora) => {
      const antes = s.ocorrencias.length;
      s.ocorrencias = s.ocorrencias.filter(
        (o) =>
          !(
            o.cteId === cteId &&
            o.codigo === codigo &&
            o.dataHora.getTime() === dataHora.getTime()
          ),
      );
      return Promise.resolve(antes - s.ocorrencias.length);
    },
    auditar: (e) => Promise.resolve(void s.auditoria.push(e.acao)),
    iniciarAplicacao: () => {
      const id = randomUUID();
      s.aplicacoes.push({ id, status: "em_andamento", erro: null });
      return Promise.resolve(id);
    },
    finalizarAplicacao: (id, status, _t, _d, erro) => {
      const a = s.aplicacoes.find((x) => x.id === id);
      if (a) Object.assign(a, { status, erro });
      return Promise.resolve();
    },
    promoverItemXml: naoUsado,
    ctePorChaveCte: naoUsado,
    ctesPorNumeroCte: naoUsado,
    ctesPorChaveNfe: naoUsado,
    ctePorId: naoUsado,
    expirarOrfaos: naoUsado,
    orfaosPendentes: naoUsado,
    marcarOrfao: naoUsado,
    registrarSincronizacao: (x) => Promise.resolve(void s.sincronizacoes.push(x)),
  };
  return r;
}

export function executarFalso(s: EstadoFalso): Transacional {
  const repo = repositorioFalso(s);
  return (fn) => fn(repo);
}

export function filaFalsa(): FilaDeAplicacao & { itens: string[] } {
  const f = {
    itens: [] as string[],
    controleAtual: {
      ultimaPreparacaoEm: null as Date | null,
      ultimaCompletaEm: null as Date | null,
    },
    substituir: (_e: string, chaves: readonly string[]) =>
      Promise.resolve(void (f.itens = [...chaves])),
    acrescentar: (_e: string, chaves: readonly string[]) => {
      const novas = chaves.filter((c) => !f.itens.includes(c));
      f.itens.push(...novas);
      return Promise.resolve(novas.length);
    },
    pendentes: (_e: string, offset: number, limite: number) =>
      Promise.resolve(f.itens.slice(offset, offset + limite)),
    contar: () => Promise.resolve(f.itens.length),
    remover: (_e: string, chaves: readonly string[]) =>
      Promise.resolve(void (f.itens = f.itens.filter((c) => !chaves.includes(c)))),
    controle: () => Promise.resolve(f.controleAtual),
    registrarPreparacao: (_e: string, completa: boolean, agora: Date) => {
      f.controleAtual = {
        ultimaPreparacaoEm: agora,
        ultimaCompletaEm: completa ? agora : f.controleAtual.ultimaCompletaEm,
      };
      return Promise.resolve();
    },
  };
  return f;
}

export function travasFalsas(): Travas & { ocupadas: Set<string> } {
  const ocupadas = new Set<string>();
  return {
    ocupadas,
    adquirir: (k) => Promise.resolve(ocupadas.has(k) ? null : (ocupadas.add(k), "token")),
    liberar: (k) => Promise.resolve(void ocupadas.delete(k)),
  };
}

export function enfileiradorFalso(): Enfileirador & {
  jobs: { nome: string; dados: Record<string, unknown> }[];
} {
  const jobs: { nome: string; dados: Record<string, unknown> }[] = [];
  return {
    jobs,
    enfileirar: (_f, nome, dados) => Promise.resolve(void jobs.push({ nome, dados })),
  };
}
