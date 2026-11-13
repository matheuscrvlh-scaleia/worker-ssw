/**
 * Handlers dos jobs da ingestão SSW por arquivo (spec 06 §4), com os nomes do catálogo
 * `@erp/shared/ingestion`. Quem agenda é o despachante (uma execução por empresa com a integração
 * ligada, só para os jobs em `INGESTAO_JOBS_LIGADOS`); a fila de cada job deduplica por empresa e
 * as travas do Redis seguram o singleton entre disparos (FTP 4 min, ciclo 180 s).
 */
import { ErroDeNegocio } from "@erp/domain/errors";
import { filaDoJob } from "@erp/shared/ingestion";
import { z } from "@erp/shared/zod";

import {
  baixarRelatoriosSsw,
  type ClienteSftp,
  type DependenciasDoFtp,
  type Enfileirador,
  type FilaDeAplicacao,
  LIMITE_PADRAO_DOS_ORFAOS,
  limparIngestao,
  type Progressos,
  reprocessarOrfaos,
  rodarCiclos,
  sincronizarFtp,
  type Transacional,
  type Travas,
  unidadePelo455Recente,
} from "../../aplicacao/casos-de-uso";
import { type Cofre, segredoDa } from "../../fontes/comum/integracao";
import { configuracaoSswWeb } from "../../fontes/ssw-web/parametros";
import { type NavegadorSswWeb, rodadaSswWeb } from "../../fontes/ssw-web/rodada";
import { montarConfiguracaoSftp, type SftpDoAmbiente } from "../../infra";
import { type ContextoDoJob, definirJob } from "../registro";
import { slaPelosArquivos } from "../sla-arquivos/job";

/** O que os jobs da ingestão usam além do banco (Redis, SFTP, cofre, fila de jobs). */
export interface ServicosDaIngestao {
  fila: FilaDeAplicacao;
  travas: Travas;
  progressos: Progressos;
  /** Jobs de outros domínios (projeções do Romaneio, 050 de Coletas). */
  enfileirador: Enfileirador;
  sftp: ClienteSftp;
  cofre: Cofre;
  /** `SFTP_*` do ambiente: só valem com `parametros.usar_env` (transição da FR). */
  sftpDoAmbiente: SftpDoAmbiente;
  /** Chromium do SSW web (`baixar-relatorios-ssw`). */
  sswWeb: NavegadorSswWeb;
  esperar: (ms: number) => Promise<void>;
}

const porEmpresa = z.object({ empresaId: z.uuid() });

function dependencias(
  { executar, agora }: ContextoDoJob,
  empresaId: string,
  s: ServicosDaIngestao,
): DependenciasDoFtp {
  const transacional: Transacional = (fn) => executar((r) => fn(r.ingestao(empresaId)));
  return {
    empresaId,
    executar: transacional,
    fila: s.fila,
    travas: s.travas,
    enfileirador: s.enfileirador,
    agora,
    sftp: s.sftp,
    credenciais: {
      sftp: async (id) => {
        const integracao = await executar(({ integracoes }) => integracoes.ler(id, "sftp"));
        const senha = integracao ? segredoDa(s.cofre, id, "sftp", integracao) : null;
        return montarConfiguracaoSftp(integracao, senha, s.sftpDoAmbiente);
      },
    },
    progressos: s.progressos,
    relogio: { agora, esperar: s.esperar },
  };
}

export function criarJobsDaIngestao(s: ServicosDaIngestao) {
  const ftp = definirJob({
    nome: "sincronizar-ftp",
    fila: filaDoJob("sincronizar-ftp"),
    escopo: "empresa",
    dados: porEmpresa.extend({ manual: z.boolean().default(false) }),
    agendamento: null,
    async processar(ctx, dados) {
      const r = await sincronizarFtp(dependencias(ctx, dados.empresaId, s), {
        manual: dados.manual,
        retroativo: false,
      });
      ctx.log.info(r, "sincronização do FTP");
      return r;
    },
  });

  const ftpRetroativo = definirJob({
    nome: "sincronizar-ftp-retroativo",
    fila: filaDoJob("sincronizar-ftp-retroativo"),
    escopo: "empresa",
    dados: porEmpresa,
    agendamento: null,
    async processar(ctx, dados) {
      const r = await sincronizarFtp(dependencias(ctx, dados.empresaId, s), {
        manual: false,
        retroativo: true,
      });
      ctx.log.info(r, "revarredura retroativa do FTP");
      return r;
    },
  });

  const ciclo = definirJob({
    nome: "aplicar-ciclos",
    fila: filaDoJob("aplicar-ciclos"),
    escopo: "empresa",
    dados: porEmpresa,
    agendamento: null,
    async processar(ctx, dados) {
      const r = await rodarCiclos(dependencias(ctx, dados.empresaId, s));
      if (r.resultados.length > 0 || r.status !== "ok") ctx.log.info(r, "ciclo de aplicação");
      return r;
    },
  });

  // Como hoje: a unidade pelo 455 primeiro, depois o SLA pelos arquivos (job da Performance).
  const slaArquivos = definirJob({
    ...slaPelosArquivos,
    async processar(ctx, dados) {
      const alterados = await unidadePelo455Recente(dependencias(ctx, dados.empresaId, s));
      ctx.log.info({ alterados }, "unidade pelo 455");
      return slaPelosArquivos.processar(ctx, dados);
    },
  });

  // Retenção da ingestão por arquivo (Q49): 038 superado, linhas, erros, arquivos/ciclos, XML,
  // órfãos e sincronizações. No contexto da empresa: o RLS limita à dela.
  const limpeza = definirJob({
    nome: "limpar-ingestao-arquivos",
    fila: filaDoJob("limpar-ingestao-arquivos"),
    escopo: "empresa",
    dados: porEmpresa,
    agendamento: null,
    async processar(ctx) {
      const r = await ctx.executar((rep) => limparIngestao(rep.retencaoDaIngestao, ctx.agora()));
      ctx.log.info(r, "limpeza da ingestão");
      return r;
    },
  });

  const xmlOrfaos = definirJob({
    nome: "reprocessar-xml-orfaos",
    fila: filaDoJob("reprocessar-xml-orfaos"),
    escopo: "empresa",
    dados: porEmpresa.extend({ limite: z.number().int().min(1).max(1000).optional() }),
    agendamento: null,
    async processar(ctx, dados) {
      const r = await reprocessarOrfaos(
        dependencias(ctx, dados.empresaId, s).executar,
        dados.limite ?? LIMITE_PADRAO_DOS_ORFAOS,
        ctx.agora(),
      );
      ctx.log.info(r, "órfãos de XML reprocessados");
      return r;
    },
  });

  // Relatórios do SSW web direto na ingestão (ADR 0018): a credencial é a da integração `ssw_web`.
  const sswWeb = definirJob({
    nome: "baixar-relatorios-ssw",
    fila: filaDoJob("baixar-relatorios-ssw"),
    escopo: "empresa",
    dados: porEmpresa.extend({
      /** Dia passado (`aaaa-mm-dd`) para repor um buraco; sem ele, os relatórios de hoje. */
      dia: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
    agendamento: null,
    async processar(ctx, { empresaId, dia }) {
      const integracao = await ctx.executar(({ integracoes }) =>
        integracoes.ler(empresaId, "ssw_web"),
      );
      const senha = integracao ? segredoDa(s.cofre, empresaId, "ssw_web", integracao) : null;
      const lida = configuracaoSswWeb(integracao, senha);
      if (!lida.ok) throw new ErroDeNegocio("ENTRADA_INVALIDA", lida.mensagem);
      const r = await baixarRelatoriosSsw({
        ...dependencias(ctx, empresaId, s),
        baixar: () => rodadaSswWeb(s.sswWeb, lida.config, ctx.agora(), dia ?? null),
      });
      if (r.status === "parcial") ctx.log.warn(r, "relatórios do SSW web com falha");
      else ctx.log.info(r, "relatórios do SSW web");
      return r;
    },
  });

  return [ftp, ftpRetroativo, sswWeb, ciclo, slaArquivos, limpeza, xmlOrfaos];
}
