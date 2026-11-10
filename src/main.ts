/**
 * worker-ssw: um processo com o HTTP (rotas públicas, interno, saúde) e os consumidores do BullMQ.
 *
 *   node dist/main.js                                   sobe o serviço
 *   node dist/main.js reconstruir-projecoes --todas     comando da virada (e sai)
 */
import { setTimeout as esperar } from "node:timers/promises";

import { comContexto, conectarBanco, type ContextoBanco, type Transacao } from "@erp/db";
import { contextoDoSegredo, decifrarSegredo, lerChavesDeSegredo } from "@erp/db/segredos";
import { filaDoJob, PREFIXO_DAS_FILAS } from "@erp/shared/ingestao";
import { z } from "@erp/shared/zod";
import { Worker } from "bullmq";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import { pino } from "pino";

import { type ColunaDoBanco, conferirSchema } from "./banco/contrato-de-schema";
import { lerAlvo, reconstruirProjecoes, USO_DA_RECONSTRUCAO } from "./cli/reconstruir-projecoes";
import { carregarAmbiente } from "./config/ambiente";
import { type JobPedivel, JOBS_PEDIVEIS } from "./contrato-interno";
import { criarRepositorioBi2 } from "./fontes/bi2/repositorio";
import { exigirEmpresa } from "./fontes/comum/empresa";
import { criarCofre } from "./fontes/comum/integracao";
import { criarRepositorioIntegracoes } from "./fontes/comum/repositorio-integracoes";
import { criarCofreDeToken, geradoEmDoToken } from "./fontes/ssw-api/cofre-de-token";
import { criarRepositorioWebhook } from "./fontes/webhook/repositorio";
import { criarRepositorioRecepcaoWebhook } from "./fontes/webhook/repositorio-recepcao";
import { construirApp } from "./http/app";
import { opcoesDeLog } from "./http/log";
import { criarRepositorioDaIngestaoPublica } from "./http/publico/repositorio";
import {
  criarClienteSftp,
  criarFilaDeAplicacao,
  criarFilas,
  criarRepositorioCteNucleo,
  criarRepositorioDeRetencao,
  criarRepositorioGravacao050,
  criarRepositorioIngestao,
  criarRepositorioProjecoesRomaneio,
  criarTravas,
} from "./infra";
import { criarContadorRedis } from "./infra/contador";
import { criarExecucoes } from "./infra/execucoes";
import { agendamentosDesejados, sincronizarAgendamentos } from "./jobs/agendamentos/agendamentos";
import { agendamentosDeIngestao } from "./jobs/agendamentos/ingestao";
import { criarRepositorioAgendamentos } from "./jobs/agendamentos/repositorio";
import { criarRepositorioManutencao } from "./jobs/manutencao/repositorio";
import { criarProcessador } from "./jobs/processador";
import { type ExecutorDoWorker, FILAS, type RepositoriosDoWorker } from "./jobs/registro";
import { criarRepositorioSlaArquivos } from "./jobs/sla-arquivos/repositorio";
import { criarJobs } from "./jobs/todos";

const PRAZO_DE_DESLIGAMENTO_MS = 30_000;
const PLATAFORMA: ContextoBanco = { empresaId: null, usuarioId: null, plataforma: true };
const daEmpresa = (empresaId: string): ContextoBanco => ({
  empresaId,
  usuarioId: null,
  plataforma: false,
});

const ambiente = carregarAmbiente(process.env);
const log = pino(opcoesDeLog(ambiente));
const chavesDeSegredo = ambiente.SEGREDOS_CHAVES
  ? lerChavesDeSegredo(ambiente.SEGREDOS_CHAVES, ambiente.SEGREDOS_CHAVE_ATUAL)
  : null;

const conexao = conectarBanco({
  url: ambiente.DATABASE_URL,
  maxConexoes: ambiente.DB_MAX_CONEXOES,
  timeoutConsultaMs: ambiente.DB_TIMEOUT_CONSULTA_MS,
  nomeAplicacao: "worker-ssw",
});

// Contrato de schema com o ERP: sem ele cumprido, nada sobe (nem o comando).
const linhaDoSchema = z.object({
  table_name: z.string(),
  column_name: z.string(),
  data_type: z.string(),
  udt_name: z.string(),
  character_maximum_length: z.coerce.number().nullable(),
  numeric_precision: z.coerce.number().nullable(),
  numeric_scale: z.coerce.number().nullable(),
});
try {
  await conferirSchema(async (consulta): Promise<ColunaDoBanco[]> => {
    const { rows } = await conexao.banco.execute(sql.raw(consulta));
    return z.array(linhaDoSchema).parse(rows);
  });
} catch (erro) {
  log.fatal({ err: erro }, "worker-ssw não sobe");
  await conexao.encerrar();
  process.exit(1);
}

function repositorios(tx: Transacao, { empresaId }: ContextoBanco): RepositoriosDoWorker {
  return {
    agendamentos: criarRepositorioAgendamentos(tx),
    manutencao: criarRepositorioManutencao(tx),
    integracoes: criarRepositorioIntegracoes(tx),
    // Só os jobs de empresa usam (BI2, webhook): sem empresa no contexto, falha no uso.
    get cteNucleo() {
      return criarRepositorioCteNucleo(tx, exigirEmpresa(empresaId));
    },
    bi2: criarRepositorioBi2(tx, empresaId),
    webhook: criarRepositorioWebhook(tx, empresaId),
    ingestao: (id) => criarRepositorioIngestao(tx, id),
    retencaoDaIngestao: criarRepositorioDeRetencao(tx),
    slaArquivos: criarRepositorioSlaArquivos(tx),
    projecoesRomaneio: criarRepositorioProjecoesRomaneio(tx, empresaId),
    coletas050: criarRepositorioGravacao050(tx),
  };
}
const executar: ExecutorDoWorker = (contexto, fn) =>
  comContexto(conexao.banco, contexto, (tx) => fn(repositorios(tx, contexto)));

if (process.argv[2] === "reconstruir-projecoes") {
  const alvo = lerAlvo(process.argv.slice(3));
  if (alvo === null) {
    log.error(USO_DA_RECONSTRUCAO);
    await conexao.encerrar();
    process.exit(2);
  }
  const resumos = await reconstruirProjecoes(executar, log, alvo);
  log.info({ empresas: resumos.length }, "reconstrução das projeções concluída");
  await conexao.encerrar();
  process.exit(0);
}

// Consumidores do BullMQ exigem maxRetriesPerRequest nulo (esperam o Redis voltar). O HTTP e os
// produtores usam outra conexão, que falha rápido: a rota responde 503 em vez de pendurar.
const redisDosWorkers = new Redis(ambiente.REDIS_URL, { maxRetriesPerRequest: null });
const redis = new Redis(ambiente.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2_000 });
const filas = criarFilas(redis);
const cofre = criarCofre(chavesDeSegredo);

const jobs = criarJobs({
  buscar: fetch,
  cofre,
  tokens: criarCofreDeToken(redisDosWorkers, chavesDeSegredo),
  despachante: {
    enfileirar: (job, dados, { deduplicar }) =>
      filas.enfileirar(filaDoJob(job), job, dados, deduplicar ? { deduplicacao: deduplicar } : {}),
  },
  ingestao: {
    fila: criarFilaDeAplicacao(redisDosWorkers),
    travas: criarTravas(redisDosWorkers),
    enfileirador: filas,
    sftp: criarClienteSftp(),
    cofre,
    sftpDoAmbiente: ambiente,
    esperar: (ms) => esperar(ms),
  },
  esperar: (ms) => esperar(ms),
});

const filaDoPedivel = new Map(
  JOBS_PEDIVEIS.map((job) => {
    const definicao = jobs.find((d) => d.nome === job);
    if (!definicao) throw new Error(`Job pedível sem registro: ${job}`);
    return [job, definicao.fila];
  }),
);
const filaDe = (job: JobPedivel) => filas.fila(filaDoPedivel.get(job) ?? job);

const workers: Worker[] = [];
const { app, metricas } = await construirApp({
  ambiente,
  log,
  redis,
  agora: () => new Date(),
  ingestao: {
    executarNaEmpresa: (empresaId) => (fn) =>
      comContexto(conexao.banco, daEmpresa(empresaId), (tx) =>
        fn(criarRepositorioIngestao(tx, empresaId)),
      ),
    empresasParaIngestao: () =>
      comContexto(conexao.banco, PLATAFORMA, (tx) =>
        criarRepositorioDaIngestaoPublica(tx).empresasParaIngestao(),
      ),
    segredosDaIngestao: async () => {
      if (chavesDeSegredo === null) return [];
      const cifrados = await comContexto(conexao.banco, PLATAFORMA, (tx) =>
        criarRepositorioDaIngestaoPublica(tx).segredosDaIngestao(),
      );
      return cifrados.flatMap(({ empresaId, segredo }) => {
        try {
          const texto = decifrarSegredo(
            chavesDeSegredo,
            segredo,
            contextoDoSegredo(empresaId, "ingestao_publica"),
          ).trim();
          return texto ? [{ empresaId, segredo: texto }] : [];
        } catch {
          log.error({ empresaId }, "segredo da ingestão pública não decifra com as chaves atuais");
          return [];
        }
      });
    },
    enfileirador: filas,
  },
  webhook: {
    executar: (contexto, fn) =>
      comContexto(conexao.banco, contexto, (tx) => fn(criarRepositorioRecepcaoWebhook(tx))),
    filas: {
      enfileirar: (job, dados, { deduplicar }) =>
        filas.enfileirar(filaDoJob(job), job, { ...dados }, { deduplicacao: deduplicar }),
    },
    chaves: chavesDeSegredo,
    falhas: criarContadorRedis(redis, "webhook:falhas", 60_000),
  },
  interno: {
    tokens: ambiente.INTERNO_TOKENS,
    jobs,
    execucoes: criarExecucoes({
      filaDoJob: filaDe,
      agendador: filas.fila("agendador"),
      tokenSswGeradoEm: (empresaId) => geradoEmDoToken(redis, empresaId),
      esperar: (ms) => esperar(ms),
    }),
  },
  prontidao: {
    verificacoes: {
      banco: conexao.verificar,
      redis: async () => {
        await redis.ping();
      },
      consumidores: () =>
        workers.every((w) => w.isRunning())
          ? Promise.resolve()
          : Promise.reject(new Error("consumidor do BullMQ parado")),
    },
  },
});

if (ambiente.WORKERS_LIGADOS) {
  const processar = criarProcessador({ jobs, executar, log, agora: () => new Date() });
  const filasComJob = FILAS.filter((f) => jobs.some((j) => j.fila === f.nome));
  for (const { nome, concorrencia, concorrenciaGlobal } of filasComJob) {
    if (concorrenciaGlobal !== undefined) {
      await filas.fila(nome).setGlobalConcurrency(concorrenciaGlobal);
    }
    const worker = new Worker(nome, processar, {
      connection: redisDosWorkers,
      concurrency: concorrencia,
      prefix: PREFIXO_DAS_FILAS,
    });
    worker.on("completed", (job) => metricas?.concluido(job.name));
    worker.on("failed", (job, erro) => {
      metricas?.falhou(job?.name ?? "desconhecido");
      log.error(
        { err: erro, job: job?.name, jobId: job?.id, tentativas: job?.attemptsMade },
        "job falhou",
      );
    });
    workers.push(worker);
  }

  // Quem consome é dono dos agendamentos: um processo só com HTTP não mexe neles.
  const empresas = ambiente.AGENDAMENTOS_LIGADOS
    ? await executar(PLATAFORMA, ({ agendamentos }) => agendamentos.empresasAtivas())
    : [];
  const registrados = new Set(jobs.map((j) => j.nome));
  for (const { nome } of filasComJob) {
    const jobsDaFila = jobs.filter((j) => j.fila === nome);
    const desejados = ambiente.AGENDAMENTOS_LIGADOS
      ? [
          ...agendamentosDesejados(jobsDaFila, empresas),
          ...(nome === "agendador"
            ? agendamentosDeIngestao(ambiente.INGESTAO_JOBS_LIGADOS, registrados)
            : []),
        ]
      : [];
    const resultado = await sincronizarAgendamentos(filas.fila(nome), desejados);
    log.info({ fila: nome, ...resultado, ligados: ambiente.AGENDAMENTOS_LIGADOS }, "agendamentos");
  }
}

await app.listen({ port: ambiente.PORTA, host: ambiente.HOST });
log.info(
  {
    porta: ambiente.PORTA,
    consumidores: workers.length,
    agendamentos: ambiente.AGENDAMENTOS_LIGADOS,
    interno: ambiente.INTERNO_TOKENS.length > 0,
  },
  "worker-ssw no ar",
);

/** Para de aceitar requisição e de pegar job, espera o que está rodando e fecha as conexões. */
async function desligar(sinal: string) {
  log.info({ sinal }, "desligando");
  setTimeout(() => {
    log.error("desligamento passou do prazo; saindo à força");
    process.exit(1);
  }, PRAZO_DE_DESLIGAMENTO_MS).unref();
  await app.close();
  await Promise.all(workers.map((w) => w.close()));
  await filas.fechar();
  await conexao.encerrar();
  await Promise.all([redis.quit(), redisDosWorkers.quit()]);
  process.exit(0);
}

for (const sinal of ["SIGTERM", "SIGINT"] as const) {
  process.once(sinal, () => void desligar(sinal));
}
