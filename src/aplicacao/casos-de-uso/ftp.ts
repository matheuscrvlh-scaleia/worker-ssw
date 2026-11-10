/**
 * Sincronização do SFTP da empresa (jobs `sincronizar-ftp` e `sincronizar-ftp-retroativo`, botão "Rodar agora").
 * Spec 06 §3.1; Q37 a (horário global de produção). O ramo de XML do FTP não é portado (§9).
 * origem: supabase/functions/processar-ftp-xmls/index.ts (sistema atual)
 */
import { diaSp, somarDiasCorridos } from "@erp/dominio/nucleo";

import { dividirCsv, MAX_PARTE_BYTES, nomeParte } from "../../fontes/relatorios";
import { mensagemDaSincronizacao, statusDaSincronizacao } from "../regras";
import { type DependenciasDoCiclo, rodarCiclos } from "./ciclo";
import { sha256 } from "./linhas";
import {
  type ClienteSftp,
  type ConexaoSftp,
  type CredenciaisDaEmpresa,
  type EntradaSftp,
  type Relogio,
} from "./portas";
import { receberArquivo } from "./receber";

export const MAX_RELATORIOS = 24;
export const ORCAMENTO_RELATORIOS_MS = 120_000;
export const RETENCAO_DIAS = 3;
export const TRAVA_DO_FTP_MS = 4 * 60_000;
export const ESTABILIDADE_MS = 20_000;
export const travaDoFtp = (empresaId: string) => `ftp:${empresaId}`;

export interface DependenciasDoFtp extends DependenciasDoCiclo {
  sftp: ClienteSftp;
  credenciais: CredenciaisDaEmpresa;
  relogio: Relogio;
}

export interface ResultadoDoFtp {
  status: "ok" | "parcial" | "erro" | "pausado" | "ja_rodando";
  mensagem: string;
}

const RE_PASTA_DIA = /^\d{4}-\d{2}-\d{2}$/;

const prefixo = (nome: string) => nome.split("_")[0] ?? nome;

/**
 * Até `max` arquivos em rodízio por tipo (prefixo antes do 1º "_", cada grupo por nome), depois os
 * de até 3 MB primeiro e os maiores por último.
 */
export function escolherArquivos(
  prontos: readonly EntradaSftp[],
  max = MAX_RELATORIOS,
): EntradaSftp[] {
  const grupos = new Map<string, EntradaSftp[]>();
  for (const a of [...prontos].sort((x, y) => x.nome.localeCompare(y.nome))) {
    grupos.set(prefixo(a.nome), [...(grupos.get(prefixo(a.nome)) ?? []), a]);
  }
  const filas = [...grupos.keys()].sort().map((k) => grupos.get(k) ?? []);
  const escolhidos: EntradaSftp[] = [];
  while (escolhidos.length < max && filas.some((f) => f.length > 0)) {
    for (const f of filas) {
      const a = f.shift();
      if (a && escolhidos.length < max) escolhidos.push(a);
    }
  }
  const pequenos = escolhidos.filter((a) => a.tamanho <= MAX_PARTE_BYTES);
  const grandes = escolhidos.filter((a) => a.tamanho > MAX_PARTE_BYTES);
  return [...pequenos, ...grandes];
}

/** Pronto = mesmo tamanho e mtime nas duas leituras, e não vazio. */
export function arquivosEstaveis(
  primeira: readonly EntradaSftp[],
  segunda: readonly EntradaSftp[],
): EntradaSftp[] {
  const antes = new Map(primeira.map((a) => [a.nome, a]));
  return segunda.filter((a) => {
    const b = antes.get(a.nome);
    return b !== undefined && a.tamanho > 0 && a.tamanho === b.tamanho && a.mtime === b.mtime;
  });
}

const ehCsv = (a: EntradaSftp) => a.tipo === "arquivo" && /\.csv$/i.test(a.nome);
const mensagemDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Envia para importados/<dia SP>/ (substitui o que tiver o mesmo nome lá). */
async function moverParaImportados(
  c: ConexaoSftp,
  origem: string,
  pastaDoDia: string,
  nome: string,
) {
  if (!(await c.existe(pastaDoDia))) await c.criarPasta(pastaDoDia);
  const destino = `${pastaDoDia}/${nome}`;
  if (await c.existe(destino)) await c.apagar(destino);
  await c.renomear(origem, destino);
}

export async function sincronizarFtp(
  deps: DependenciasDoFtp,
  opcoes: { manual: boolean; retroativo: boolean },
): Promise<ResultadoDoFtp> {
  const { empresaId } = deps;
  const inicio = deps.relogio.agora();
  const disparadoPor = opcoes.manual ? "manual" : "agendamento";
  const registrar = (s: {
    status: "ok" | "parcial" | "erro" | "pausado";
    mensagem: string;
    erros?: string[];
    processados?: number;
    movidos?: number;
    pastas?: number;
    comErro?: number;
  }) =>
    deps.executar((r) =>
      r.registrarSincronizacao({
        executadoEm: inicio,
        finalizadoEm: deps.relogio.agora(),
        status: s.status,
        disparadoPor,
        arquivosProcessados: s.processados ?? 0,
        arquivosMovidos: s.movidos ?? 0,
        pastasLimpas: s.pastas ?? 0,
        arquivosComErro: s.comErro ?? 0,
        duracaoMs: deps.relogio.agora().getTime() - inicio.getTime(),
        mensagem: s.mensagem,
        erros: s.erros ?? [],
      }),
    );

  if (!opcoes.manual) {
    const config = await deps
      .executar((r) => r.configuracoes(["ftp_sync_ativo"]))
      .catch(() => null);
    if (config?.get("ftp_sync_ativo") === "false") {
      const mensagem = "Sincronização pausada pelo administrador";
      await registrar({ status: "pausado", mensagem });
      return { status: "pausado", mensagem };
    }
  }
  const cfg = await deps.credenciais.sftp(empresaId);
  if (!cfg) {
    const mensagem = "Segredos FTP/INGEST não configurados";
    await registrar({ status: "erro", mensagem, erros: [mensagem] });
    return { status: "erro", mensagem };
  }
  const token = await deps.travas.adquirir(travaDoFtp(empresaId), TRAVA_DO_FTP_MS);
  if (token === null) return { status: "ja_rodando", mensagem: "Sincronização já em andamento." };

  let conexao: ConexaoSftp | null = null;
  try {
    try {
      conexao = await deps.sftp.conectar(cfg);
    } catch (e) {
      const mensagem = `SFTP indisponível: ${mensagemDe(e)}`;
      await registrar({ status: "erro", mensagem, erros: [mensagem] });
      return { status: "erro", mensagem };
    }
    const c = conexao;
    const hoje = diaSp(inicio);
    const pastaDoDia = `${cfg.importadosPath}/${hoje}`;
    const erros: string[] = [];
    let movidos = 0;
    let duplicados = 0;
    let comErro = 0;
    let pastas = 0;
    const receber = (nome: string, bytes: Uint8Array, mtime: number) =>
      receberArquivo(deps, { nome, bytes, sha256: sha256(bytes), tamanho: bytes.length, mtime });

    if (await c.existe(cfg.relatoriosPath)) {
      // a. retenção das pastas de importados
      if (await c.existe(cfg.importadosPath)) {
        const limite = somarDiasCorridos(hoje, -RETENCAO_DIAS);
        for (const p of await c.listar(cfg.importadosPath)) {
          if (p.tipo === "pasta" && RE_PASTA_DIA.test(p.nome) && p.nome <= limite) {
            await c.apagarPasta(`${cfg.importadosPath}/${p.nome}`);
            pastas++;
          }
        }
      }
      // b. estabilidade + c. rodízio
      const primeira = (await c.listar(cfg.relatoriosPath)).filter(ehCsv);
      await deps.relogio.esperar(ESTABILIDADE_MS);
      const segunda = (await c.listar(cfg.relatoriosPath)).filter(ehCsv);
      const escolhidos = escolherArquivos(arquivosEstaveis(primeira, segunda));
      // d. cada arquivo, dentro do orçamento
      const t0 = deps.relogio.agora().getTime();
      for (const a of escolhidos) {
        if (deps.relogio.agora().getTime() - t0 >= ORCAMENTO_RELATORIOS_MS) break;
        const caminho = `${cfg.relatoriosPath}/${a.nome}`;
        try {
          const bytes = await c.baixar(caminho);
          if (bytes.length > MAX_PARTE_BYTES) {
            const partes = dividirCsv(bytes);
            for (const [j, parte] of partes.entries()) {
              const destino = `${cfg.relatoriosPath}/${nomeParte(a.nome, j + 1)}`;
              if (await c.existe(destino)) await c.apagar(destino);
              await c.enviar(parte, `${destino}.tmp`);
              await c.renomear(`${destino}.tmp`, destino);
            }
            await moverParaImportados(c, caminho, pastaDoDia, a.nome);
            movidos++;
            continue;
          }
          const res = await receber(a.nome, bytes, a.mtime);
          if (!res.ok) {
            comErro++;
            erros.push(`${a.nome}: ${res.mensagem}`);
            continue;
          }
          await moverParaImportados(c, caminho, pastaDoDia, a.nome);
          if (res.status === "ignorado") duplicados++;
          else movidos++;
        } catch (e) {
          comErro++;
          erros.push(`${a.nome}: ${mensagemDe(e)}`);
        }
      }
      // e. sempre: o ciclo de aplicação
      try {
        await rodarCiclos(deps);
      } catch (e) {
        erros.push(`ssw-ciclo-aplicar: ${mensagemDe(e)}`);
      }
      // f. retroativo: reenvia o que está em importados/ e nunca foi registrado
      if (opcoes.retroativo && (await c.existe(cfg.importadosPath))) {
        const registrados = await deps.executar((r) => r.nomesDeArquivosRegistrados());
        const t1 = deps.relogio.agora().getTime();
        const dentro = () => deps.relogio.agora().getTime() - t1 < ORCAMENTO_RELATORIOS_MS;
        for (const pasta of await c.listar(cfg.importadosPath)) {
          if (pasta.tipo !== "pasta" || !RE_PASTA_DIA.test(pasta.nome) || !dentro()) continue;
          for (const a of (await c.listar(`${cfg.importadosPath}/${pasta.nome}`)).filter(ehCsv)) {
            if (!dentro()) break;
            const grande = a.tamanho > MAX_PARTE_BYTES;
            if (registrados.has(grande ? nomeParte(a.nome, 1) : a.nome)) continue;
            try {
              const bytes = await c.baixar(`${cfg.importadosPath}/${pasta.nome}/${a.nome}`);
              const envios = grande
                ? dividirCsv(bytes).map((b, j) => ({ nome: nomeParte(a.nome, j + 1), bytes: b }))
                : [{ nome: a.nome, bytes }];
              for (const envio of envios) {
                if (!dentro()) break;
                const res = await receber(envio.nome, envio.bytes, a.mtime);
                if (!res.ok) {
                  comErro++;
                  erros.push(`${envio.nome}: ${res.mensagem}`);
                  break;
                }
              }
            } catch (e) {
              comErro++;
              erros.push(`${a.nome}: ${mensagemDe(e)}`);
            }
          }
        }
      }
    }
    const processados = movidos + duplicados;
    const status = statusDaSincronizacao(processados, comErro);
    const mensagem = mensagemDaSincronizacao({ movidos, comErro, pastasLimpas: pastas });
    await registrar({
      status,
      mensagem,
      erros,
      processados,
      movidos: processados,
      pastas,
      comErro,
    });
    return { status, mensagem };
  } finally {
    await conexao?.encerrar().catch(() => undefined);
    await deps.travas.liberar(travaDoFtp(empresaId), token);
  }
}
