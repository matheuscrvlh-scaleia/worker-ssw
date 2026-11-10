/** App HTTP dos testes: tudo falso por padrão, cada teste troca só o que precisa. */
import { type ContextoBanco } from "@erp/db";
import { pino } from "pino";

import { type OperacoesManuais } from "../aplicacao/casos-de-uso";
import {
  type EmpresaDoWebhook,
  type EventoRecebido,
  type FilaDoWebhook,
} from "../fontes/webhook/recepcao";
import { type RepositorioRecepcaoWebhook } from "../fontes/webhook/repositorio-recepcao";
import { construirApp, type DependenciasHttp } from "../http/app";
import { type ContadorPorJanela } from "../infra/contador";
import { type Execucoes } from "../infra/execucoes";
import { enfileiradorFalso, estadoFalso, executarFalso } from "./falsos";

/** Banco falso da recepção do webhook: eventos gravados e o contexto de cada transação. */
export class RecepcaoFalsa {
  empresas: EmpresaDoWebhook[] = [];
  eventos: (EventoRecebido & { id: string })[] = [];
  contextos: ContextoBanco[] = [];

  readonly executar = <T>(
    contexto: ContextoBanco,
    fn: (r: RepositorioRecepcaoWebhook) => Promise<T>,
  ): Promise<T> => {
    this.contextos.push(contexto);
    return fn({
      empresasComWebhook: () => Promise.resolve(this.empresas),
      registrarEvento: (e) => {
        const id = `00000000-0000-4000-8000-${String(this.eventos.length + 1).padStart(12, "0")}`;
        this.eventos.push({ ...e, id });
        return Promise.resolve(id);
      },
      quarentenaDesde: () =>
        Promise.resolve(
          this.eventos.filter((e) => !e.autenticado && e.payloadBruto !== null).length,
        ),
      marcarEvento: (eventoId, statusHttp, erro) => {
        const e = this.eventos.find((x) => x.id === eventoId);
        if (e) Object.assign(e, { statusHttp, erroProcessamento: erro });
        return Promise.resolve();
      },
    });
  };
}

/** Fila do webhook que guarda o que entrou (ou falha, como o Redis fora). */
export class FilaDoWebhookFalsa implements FilaDoWebhook {
  enfileirados: { job: string; dados: Readonly<Record<string, unknown>>; deduplicar: string }[] =
    [];
  falhar = false;
  enfileirar(
    job: "processar-webhook-ssw",
    dados: Readonly<Record<string, unknown>>,
    { deduplicar }: { deduplicar: string },
  ) {
    if (this.falhar) return Promise.reject(new Error("redis fora"));
    this.enfileirados.push({ job, dados, deduplicar });
    return Promise.resolve();
  }
}

/** Contador por janela na memória (no lugar do Redis). */
export function criarContadorEmMemoria(
  janelaMs: number,
  agora: () => number = Date.now,
): ContadorPorJanela {
  const janelas = new Map<string, { ate: number; total: number }>();
  return {
    somar: (chave) => {
      const atual = janelas.get(chave);
      const janela = atual && atual.ate > agora() ? atual : { ate: agora() + janelaMs, total: 0 };
      janela.total += 1;
      janelas.set(chave, janela);
      return Promise.resolve(janela.total);
    },
  };
}

export const execucoesQueNaoDevemSerUsadas: Execucoes = {
  pedir: () => Promise.reject(new Error("não usado")),
  consultar: () => Promise.reject(new Error("não usado")),
  situacao: () => Promise.reject(new Error("não usado")),
};

const naoUsado = () => Promise.reject(new Error("não usado"));
export const manuaisQueNaoDevemSerUsadas: OperacoesManuais = {
  retomarCiclo: naoUsado,
  descartarCiclo: naoUsado,
  importarRelatorio: naoUsado,
  aplicar: naoUsado,
  lerFtp: naoUsado,
  ativarFtp: naoUsado,
  liberarTravaDoFtp: naoUsado,
  importarXml: naoUsado,
};

export function dependenciasDeTeste(troca: Partial<DependenciasHttp> = {}): DependenciasHttp {
  const agora = () => new Date("2026-11-10T12:00:00Z");
  return {
    ambiente: { PROXIES_CONFIAVEIS: 0, METRICAS_TOKEN: undefined },
    log: pino({ level: "silent" }),
    redis: null,
    agora,
    ingestao: {
      executarNaEmpresa: () => executarFalso(estadoFalso()),
      empresasParaIngestao: () => Promise.resolve([]),
      segredosDaIngestao: () => Promise.resolve([]),
      enfileirador: enfileiradorFalso(),
    },
    webhook: {
      executar: new RecepcaoFalsa().executar,
      filas: new FilaDoWebhookFalsa(),
      chaves: null,
      falhas: criarContadorEmMemoria(60_000, () => agora().getTime()),
    },
    interno: {
      tokens: [],
      execucoes: execucoesQueNaoDevemSerUsadas,
      jobs: [],
      manuais: manuaisQueNaoDevemSerUsadas,
    },
    prontidao: { verificacoes: {} },
    ...troca,
  };
}

export async function appDeTeste(troca: Partial<DependenciasHttp> = {}) {
  const { app } = await construirApp(dependenciasDeTeste(troca));
  return app;
}
