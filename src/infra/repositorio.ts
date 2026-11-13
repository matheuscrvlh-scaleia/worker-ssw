/**
 * Repositório Drizzle da ingestão, preso a uma transação no contexto da empresa (RLS). Toda
 * gravação leva a `empresa_id` explícita; todo casamento de CT-e é por (empresa, sigla, número).
 */
import { type Transacao } from "@erp/db";
import {
  auditoria,
  codigosOcorrencia,
  configuracoes,
  ctePrazoHistorico,
  ctes,
  empresaIntegracoes,
  empresas,
  filiais,
  ingestaoAplicacoes,
  ingestaoArquivos,
  ingestaoCiclos,
  ingestaoErros,
  ingestaoLinhas,
  ingestaoRelatoriosEsperados,
  ocorrencias,
  prazosConfigurados,
  xmlCteArquivos,
  xmlCteItens,
  xmlCteOrfaos,
  xmlFtpSincronizacoes,
} from "@erp/db/schema";
import {
  cnpjsPropriosDaEmpresa,
  lerConfiguracaoDoNucleo,
  montarCatalogo,
  type OcorrenciaDoCte,
} from "@erp/domain/core";
import { configuracoesVigentes } from "@erp/domain/settings";
import { and, asc, count, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";

import {
  type ArquivoRegistrado,
  type CicloRegistrado,
  type LinhaDaChave,
  type RepositorioCteNucleo,
  type RepositorioDeRetencao,
  type RepositorioIngestao,
} from "../aplicacao/casos-de-uso/portas";
import {
  type ChaveCte,
  chaveDoCte,
  type CteDaIngestao,
  STATUS_CICLO_ABERTO,
} from "../aplicacao/regras";

const LOTE_DE_GRAVACAO = 500;

function emBlocos<T>(itens: readonly T[], tamanho: number): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) blocos.push(itens.slice(i, i + tamanho));
  return blocos;
}

const CHAVES_DO_NUCLEO = [
  "alerta_dias_sem_movimento",
  "ctrc_data_minima_emissao",
  "prazo_padrao_dias",
  "raiz_cnpj_troca",
];

function comoCiclo(c: typeof ingestaoCiclos.$inferSelect): CicloRegistrado {
  return {
    cicloChave: c.cicloChave,
    status: c.status,
    motivo: c.motivo,
    faltantes: Array.isArray(c.faltantes) ? c.faltantes.map(String) : [],
    totais:
      typeof c.totais === "object" && c.totais !== null && !Array.isArray(c.totais)
        ? (c.totais as Record<string, unknown>)
        : {},
    arquivosImportados: c.arquivosImportados,
    linhasImportadas: c.linhasImportadas,
    primeiroArquivoEm: c.primeiroArquivoEm,
    ultimoArquivoEm: c.ultimoArquivoEm,
    fechadoEm: c.fechadoEm,
    aplicadoEm: c.aplicadoEm,
  };
}

const comoArquivo = (a: typeof ingestaoArquivos.$inferSelect): ArquivoRegistrado => ({
  id: a.id,
  nomeArquivo: a.nomeArquivo,
  cicloChave: a.cicloChave,
  relatorio: a.relatorio,
  unidade: a.unidade,
  status: a.status,
  sha256: a.sha256,
  linhas: a.linhas,
  loteId: a.loteId,
  mensagem: a.mensagem,
  vistoEm: a.vistoEm,
  importadoEm: a.importadoEm,
});

/**
 * O schema guarda `ocorr_efetiva_fonte` como texto; o núcleo o fecha num tipo. Exportado para o
 * BI2 e o webhook, que buscam o CT-e pelos próprios critérios.
 */
export const comoCte = (c: typeof ctes.$inferSelect) => c as CteDaIngestao;

function filtrarPelaChave<T extends { sigla: string | null; numero: string | null }>(
  linhas: readonly T[],
  chaves: readonly ChaveCte[],
): (T & ChaveCte)[] {
  const quero = new Set(chaves.map(chaveDoCte));
  return linhas.filter(
    (l): l is T & ChaveCte =>
      l.sigla !== null && l.numero !== null && quero.has(chaveDoCte(l as ChaveCte)),
  );
}

const numeros = (chaves: readonly ChaveCte[]) => [...new Set(chaves.map((c) => c.numero))];

export function criarRepositorioIngestao(tx: Transacao, empresaId: string): RepositorioIngestao {
  const daEmpresa = (t: { empresaId: Parameters<typeof eq>[0] }) => eq(t.empresaId, empresaId);

  const repo: RepositorioIngestao = {
    async empresa() {
      const [e] = await tx
        .select({
          id: empresas.id,
          nome: empresas.nome,
          dominioSsw: empresas.dominioSsw,
          cnpj: empresas.cnpj,
        })
        .from(empresas)
        .where(eq(empresas.id, empresaId));
      if (!e) throw new Error(`Empresa da ingestão inexistente: ${empresaId}`);
      return e;
    },

    async configuracoes(chaves) {
      if (chaves.length === 0) return new Map();
      const linhas = await tx
        .select({
          empresaId: configuracoes.empresaId,
          chave: configuracoes.chave,
          valor: configuracoes.valor,
        })
        .from(configuracoes)
        .where(
          and(
            inArray(configuracoes.chave, [...chaves]),
            sql`(${configuracoes.empresaId} = ${empresaId} or ${configuracoes.empresaId} is null)`,
          ),
        );
      // Sem cache: a pausa do FTP (`ftp_sync_ativo`) vale na próxima execução.
      return configuracoesVigentes(linhas);
    },

    async gravarConfiguracao(chave, valor) {
      await tx
        .insert(configuracoes)
        .values({
          empresaId,
          chave,
          valor,
          descricao: "",
          grupo: "ingestao",
          atualizadoPor: null,
        })
        .onConflictDoUpdate({
          target: [configuracoes.empresaId, configuracoes.chave],
          set: { valor, atualizadoEm: sql`now()`, atualizadoPor: null },
        });
    },

    async arquivoPorNome(nome) {
      const [a] = await tx
        .select()
        .from(ingestaoArquivos)
        .where(and(daEmpresa(ingestaoArquivos), eq(ingestaoArquivos.nomeArquivo, nome)));
      return a ? comoArquivo(a) : null;
    },

    async registrarArquivo(r) {
      const valores = {
        ...r,
        vistoEm: sql`now()`,
        importadoEm: r.status === "importado" ? sql`now()` : null,
        atualizadoEm: sql`now()`,
      };
      await tx
        .insert(ingestaoArquivos)
        .values({ empresaId, ...valores })
        .onConflictDoUpdate({
          target: [ingestaoArquivos.empresaId, ingestaoArquivos.nomeArquivo],
          set: valores,
        });
    },

    async nomesDeArquivosRegistrados() {
      const linhas = await tx
        .select({ nome: ingestaoArquivos.nomeArquivo })
        .from(ingestaoArquivos)
        .where(daEmpresa(ingestaoArquivos));
      return new Set(linhas.map((l) => l.nome));
    },

    async garantirCiclo(cicloChave) {
      await tx.insert(ingestaoCiclos).values({ empresaId, cicloChave }).onConflictDoNothing();
    },

    async ciclo(cicloChave) {
      const [c] = await tx
        .select()
        .from(ingestaoCiclos)
        .where(and(daEmpresa(ingestaoCiclos), eq(ingestaoCiclos.cicloChave, cicloChave)));
      return c ? comoCiclo(c) : null;
    },

    async mudarCiclo(cicloChave, m) {
      const { somarArquivos, somarLinhas, tocarUltimoArquivo, ...campos } = m;
      await tx
        .update(ingestaoCiclos)
        .set({
          ...campos,
          ...(somarArquivos
            ? { arquivosImportados: sql`${ingestaoCiclos.arquivosImportados} + ${somarArquivos}` }
            : {}),
          ...(somarLinhas
            ? { linhasImportadas: sql`${ingestaoCiclos.linhasImportadas} + ${somarLinhas}` }
            : {}),
          ...(tocarUltimoArquivo ? { ultimoArquivoEm: sql`now()` } : {}),
          atualizadoEm: sql`now()`,
        })
        .where(and(daEmpresa(ingestaoCiclos), eq(ingestaoCiclos.cicloChave, cicloChave)));
    },

    async ciclosAbertos(limite) {
      const linhas = await tx
        .select()
        .from(ingestaoCiclos)
        .where(
          and(daEmpresa(ingestaoCiclos), inArray(ingestaoCiclos.status, [...STATUS_CICLO_ABERTO])),
        )
        .orderBy(asc(ingestaoCiclos.cicloChave))
        .limit(limite);
      return linhas.map(comoCiclo);
    },

    async fecharCiclosCobertos(ate, agora) {
      const linhas = await tx
        .update(ingestaoCiclos)
        .set({ status: "aplicado", aplicadoEm: agora, atualizadoEm: agora })
        .where(
          and(
            daEmpresa(ingestaoCiclos),
            inArray(ingestaoCiclos.status, [...STATUS_CICLO_ABERTO]),
            lte(ingestaoCiclos.ultimoArquivoEm, ate),
          ),
        )
        .returning({ id: ingestaoCiclos.id });
      return linhas.length;
    },

    async arquivosDoCiclo(cicloChave) {
      const linhas = await tx
        .select()
        .from(ingestaoArquivos)
        .where(and(daEmpresa(ingestaoArquivos), eq(ingestaoArquivos.cicloChave, cicloChave)));
      return linhas.map(comoArquivo);
    },

    async marcarArquivosDescartados(cicloChave) {
      await tx
        .update(ingestaoArquivos)
        .set({
          status: "descartado",
          mensagem: sql`coalesce(${ingestaoArquivos.mensagem}, '') || ' [ciclo descartado]'`,
          atualizadoEm: sql`now()`,
        })
        .where(and(daEmpresa(ingestaoArquivos), eq(ingestaoArquivos.cicloChave, cicloChave)));
    },

    async relatoriosEsperados() {
      return tx
        .select({
          relatorio: ingestaoRelatoriosEsperados.relatorio,
          porUnidade: ingestaoRelatoriosEsperados.porUnidade,
          unidadesEsperadas: ingestaoRelatoriosEsperados.unidadesEsperadas,
          obrigatorioNoCiclo: ingestaoRelatoriosEsperados.obrigatorioNoCiclo,
          ativo: ingestaoRelatoriosEsperados.ativo,
        })
        .from(ingestaoRelatoriosEsperados)
        .where(daEmpresa(ingestaoRelatoriosEsperados));
    },

    async gravarLinhas(relatorio, loteId, arquivoId, linhas) {
      let gravadas = 0;
      for (const bloco of emBlocos(linhas, LOTE_DE_GRAVACAO)) {
        const valores = bloco.map((l) => ({ empresaId, relatorio, loteId, arquivoId, ...l }));
        const insercao = tx.insert(ingestaoLinhas).values(valores);
        // 455 CSV traz o mês inteiro: só o que mudou entra. Os demais "passam" a linha idêntica
        // para o lote novo e a deixam pendente (o 038 mais novo é a foto completa).
        const feitas =
          relatorio === "455csv"
            ? await insercao.onConflictDoNothing().returning({ id: ingestaoLinhas.id })
            : await insercao
                .onConflictDoUpdate({
                  target: [ingestaoLinhas.empresaId, ingestaoLinhas.relatorio, ingestaoLinhas.hash],
                  set: {
                    loteId: sql`excluded.lote_id`,
                    arquivoId: sql`excluded.arquivo_id`,
                    numeroLinha: sql`excluded.numero_linha`,
                    importadoEm: sql`now()`,
                    aplicadoEm: null,
                  },
                })
                .returning({ id: ingestaoLinhas.id });
        gravadas += feitas.length;
      }
      return gravadas;
    },

    async gravarErros(loteId, erros) {
      for (const bloco of emBlocos(erros, LOTE_DE_GRAVACAO)) {
        await tx.insert(ingestaoErros).values(bloco.map((e) => ({ empresaId, loteId, ...e })));
      }
    },

    async linhasDasChaves(relatorio, chaves) {
      if (chaves.length === 0) return [];
      const saida: LinhaDaChave[] = [];
      for (const bloco of emBlocos(numeros(chaves), 5000)) {
        const linhas = await tx
          .select({
            id: ingestaoLinhas.id,
            loteId: ingestaoLinhas.loteId,
            importadoEm: ingestaoLinhas.importadoEm,
            sigla: ingestaoLinhas.sigla,
            numero: ingestaoLinhas.numero,
            dados: ingestaoLinhas.dados,
          })
          .from(ingestaoLinhas)
          .where(
            and(
              daEmpresa(ingestaoLinhas),
              inArray(ingestaoLinhas.numero, bloco),
              eq(ingestaoLinhas.relatorio, relatorio),
            ),
          );
        saida.push(...filtrarPelaChave(linhas, chaves));
      }
      return saida;
    },

    async chavesPendentes(relatorios, limite) {
      const linhas = await tx
        .selectDistinct({ sigla: ingestaoLinhas.sigla, numero: ingestaoLinhas.numero })
        .from(ingestaoLinhas)
        .where(
          and(
            daEmpresa(ingestaoLinhas),
            inArray(ingestaoLinhas.relatorio, [...relatorios]),
            isNull(ingestaoLinhas.aplicadoEm),
            isNotNull(ingestaoLinhas.numero),
            isNotNull(ingestaoLinhas.sigla),
          ),
        )
        .limit(limite);
      return linhas.flatMap((l) =>
        l.sigla && l.numero ? [{ sigla: l.sigla, numero: l.numero }] : [],
      );
    },

    async todasAsChaves(relatorios) {
      const linhas = await tx
        .selectDistinct({ sigla: ingestaoLinhas.sigla, numero: ingestaoLinhas.numero })
        .from(ingestaoLinhas)
        .where(
          and(
            daEmpresa(ingestaoLinhas),
            inArray(ingestaoLinhas.relatorio, [...relatorios]),
            isNotNull(ingestaoLinhas.numero),
            isNotNull(ingestaoLinhas.sigla),
          ),
        )
        .orderBy(asc(ingestaoLinhas.numero));
      return linhas.flatMap((l) =>
        l.sigla && l.numero ? [{ sigla: l.sigla, numero: l.numero }] : [],
      );
    },

    async marcarAplicadas(relatorios, chaves, agora) {
      for (const bloco of emBlocos(chaves, 1000)) {
        const pares = sql.join(
          bloco.map((c) => sql`(${c.sigla}, ${c.numero})`),
          sql`, `,
        );
        await tx
          .update(ingestaoLinhas)
          .set({ aplicadoEm: agora })
          .where(
            and(
              daEmpresa(ingestaoLinhas),
              inArray(ingestaoLinhas.relatorio, [...relatorios]),
              inArray(ingestaoLinhas.numero, numeros(bloco)),
              isNull(ingestaoLinhas.aplicadoEm),
              sql`(${ingestaoLinhas.sigla}, ${ingestaoLinhas.numero}) in (${pares})`,
            ),
          );
      }
    },

    async linhasSemChave(relatorios) {
      const [r] = await tx
        .select({ n: count() })
        .from(ingestaoLinhas)
        .where(
          and(
            daEmpresa(ingestaoLinhas),
            inArray(ingestaoLinhas.relatorio, [...relatorios]),
            isNull(ingestaoLinhas.numero),
            isNull(ingestaoLinhas.aplicadoEm),
          ),
        );
      return r?.n ?? 0;
    },

    async chavesDesde(relatorio, desde) {
      const linhas = await tx
        .selectDistinct({ sigla: ingestaoLinhas.sigla, numero: ingestaoLinhas.numero })
        .from(ingestaoLinhas)
        .where(
          and(
            daEmpresa(ingestaoLinhas),
            eq(ingestaoLinhas.relatorio, relatorio),
            sql`${ingestaoLinhas.importadoEm} >= ${desde}`,
            isNotNull(ingestaoLinhas.numero),
            isNotNull(ingestaoLinhas.sigla),
          ),
        );
      return linhas.flatMap((l) =>
        l.sigla && l.numero ? [{ sigla: l.sigla, numero: l.numero }] : [],
      );
    },

    async apagarLotes(loteIds) {
      if (loteIds.length === 0) return { linhas: 0, erros: 0, apagadas: [] };
      const linhas = await tx
        .delete(ingestaoLinhas)
        .where(and(daEmpresa(ingestaoLinhas), inArray(ingestaoLinhas.loteId, [...loteIds])))
        .returning({
          relatorio: ingestaoLinhas.relatorio,
          sigla: ingestaoLinhas.sigla,
          numero: ingestaoLinhas.numero,
          dados: ingestaoLinhas.dados,
        });
      const erros = await tx
        .delete(ingestaoErros)
        .where(and(daEmpresa(ingestaoErros), inArray(ingestaoErros.loteId, [...loteIds])))
        .returning({ id: ingestaoErros.id });
      return { linhas: linhas.length, erros: erros.length, apagadas: linhas };
    },

    async cadastrosDoNucleo() {
      const codigos = await tx
        .select({
          codigo: codigosOcorrencia.codigo,
          descricao: codigosOcorrencia.descricao,
          tipoSsw: codigosOcorrencia.tipoSsw,
          processoSsw: codigosOcorrencia.processoSsw,
          responsavel: codigosOcorrencia.responsavel,
          penaliza: codigosOcorrencia.penaliza,
        })
        .from(codigosOcorrencia)
        .where(daEmpresa(codigosOcorrencia));
      const listaDeFiliais = await tx
        .select({
          sigla: filiais.sigla,
          cidade: filiais.cidade,
          uf: filiais.uf,
          propria: filiais.propria,
        })
        .from(filiais)
        .where(daEmpresa(filiais));
      const regras = await tx
        .select({
          id: prazosConfigurados.id,
          tipo: prazosConfigurados.tipo,
          unidadeCodigo: prazosConfigurados.unidadeCodigo,
          unidadeDestinoCodigo: prazosConfigurados.unidadeDestinoCodigo,
          parceiroCnpj: prazosConfigurados.parceiroCnpj,
          prazoHoras: prazosConfigurados.prazoHoras,
          prazoDias: prazosConfigurados.prazoDias,
          ativo: prazosConfigurados.ativo,
          criadoEm: prazosConfigurados.criadoEm,
        })
        .from(prazosConfigurados)
        .where(daEmpresa(prazosConfigurados));
      const [xml] = await tx
        .select({ parametros: empresaIntegracoes.parametros })
        .from(empresaIntegracoes)
        .where(
          and(eq(empresaIntegracoes.empresaId, empresaId), eq(empresaIntegracoes.tipo, "xml_cte")),
        );
      const emitentes = xml?.parametros.cnpjs_emitentes;
      const empresa = await repo.empresa();
      return {
        catalogo: montarCatalogo(codigos),
        filiais: listaDeFiliais,
        regrasDePrazo: regras,
        config: lerConfiguracaoDoNucleo(await repo.configuracoes(CHAVES_DO_NUCLEO)),
        cnpjsProprios: cnpjsPropriosDaEmpresa(
          empresa.cnpj,
          Array.isArray(emitentes) ? emitentes.map(String) : [],
        ),
        dominioSsw: empresa.dominioSsw,
      };
    },

    async ctesDasChaves(chaves) {
      if (chaves.length === 0) return [];
      const saida: CteDaIngestao[] = [];
      for (const bloco of emBlocos(numeros(chaves), 5000)) {
        const linhas = await tx
          .select()
          .from(ctes)
          .where(and(daEmpresa(ctes), inArray(ctes.numero, bloco)));
        saida.push(...filtrarPelaChave(linhas.map(comoCte), chaves));
      }
      return saida;
    },

    async inserirCtes(novos) {
      const saida: CteDaIngestao[] = [];
      for (const bloco of emBlocos(novos, LOTE_DE_GRAVACAO)) {
        const linhas = await tx
          .insert(ctes)
          .values(bloco.map((c) => ({ ...c, camposSsw: [...c.camposSsw] })))
          .onConflictDoNothing()
          .returning();
        saida.push(...linhas.map(comoCte));
      }
      return saida;
    },

    async atualizarCte(id, campos) {
      const { camposSsw, ...resto } = campos;
      await tx
        .update(ctes)
        .set({ ...resto, ...(camposSsw ? { camposSsw: [...camposSsw] } : {}) })
        .where(and(daEmpresa(ctes), eq(ctes.id, id)));
    },

    async registrarTrocaDePrevisao(cteId, troca) {
      await tx.insert(ctePrazoHistorico).values({ empresaId, cteId, ...troca });
    },

    async cteDaChave(chave) {
      const [c] = await tx
        .select({ id: ctes.id })
        .from(ctes)
        .where(and(daEmpresa(ctes), eq(ctes.chave, chave)))
        .limit(1);
      return c?.id ?? null;
    },

    async ocorrenciasDosCtes(ids) {
      const saida = new Map<string, OcorrenciaDoCte[]>();
      for (const bloco of emBlocos([...new Set(ids)], 5000)) {
        const linhas = await tx
          .select({
            id: ocorrencias.id,
            cteId: ocorrencias.cteId,
            codigo: ocorrencias.codigo,
            descricao: ocorrencias.descricao,
            dataHora: ocorrencias.dataHora,
            filial: ocorrencias.filial,
            origem: ocorrencias.origem,
            quarentena: ocorrencias.quarentena,
            criadoEm: ocorrencias.criadoEm,
          })
          .from(ocorrencias)
          .where(and(daEmpresa(ocorrencias), inArray(ocorrencias.cteId, bloco)));
        for (const { cteId, ...o } of linhas) saida.set(cteId, [...(saida.get(cteId) ?? []), o]);
      }
      return saida;
    },

    async inserirCodigos(codigos) {
      if (codigos.length === 0) return;
      await tx
        .insert(codigosOcorrencia)
        .values(codigos.map((c) => ({ empresaId, ...c })))
        .onConflictDoNothing();
    },

    async inserirOcorrencias(lista) {
      const ctes: string[] = [];
      for (const bloco of emBlocos(lista, LOTE_DE_GRAVACAO)) {
        const feitas = await tx
          .insert(ocorrencias)
          .values(bloco.map((o) => ({ empresaId, ...o })))
          .onConflictDoNothing()
          .returning({ cteId: ocorrencias.cteId });
        ctes.push(...feitas.map((f) => f.cteId));
      }
      return ctes;
    },

    async apagarOcorrencia(cteId, codigo, dataHora) {
      const feitas = await tx
        .delete(ocorrencias)
        .where(
          and(
            daEmpresa(ocorrencias),
            eq(ocorrencias.cteId, cteId),
            eq(ocorrencias.codigo, codigo),
            eq(ocorrencias.dataHora, dataHora),
          ),
        )
        .returning({ id: ocorrencias.id });
      return feitas.length;
    },

    async auditar(evento) {
      await tx.insert(auditoria).values({
        empresaId,
        atorId: null,
        atorEmail: null,
        atorTipo: "sistema",
        acao: evento.acao,
        entidade: evento.entidade,
        entidadeId: evento.entidadeId,
        resumo: evento.resumo,
        antes: null,
        depois: evento.depois,
        ip: null,
        userAgent: null,
      });
    },

    async iniciarAplicacao(simulacao, usuarioId) {
      const [a] = await tx
        .insert(ingestaoAplicacoes)
        .values({ empresaId, simulacao, aplicadoPor: usuarioId })
        .returning({ id: ingestaoAplicacoes.id });
      if (!a) throw new Error("Falha ao registrar a aplicação.");
      return a.id;
    },

    async finalizarAplicacao(id, status, totais, detalhe, erro) {
      await tx
        .update(ingestaoAplicacoes)
        .set({
          status,
          totalInseridos: totais.inserir,
          totalAtualizados: totais.atualizar,
          totalOcorrencias: totais.ocorrencias,
          totalIgnorados: totais.ignorados,
          detalhe,
          erro,
          finalizadoEm: sql`now()`,
        })
        .where(and(daEmpresa(ingestaoAplicacoes), eq(ingestaoAplicacoes.id, id)));
    },

    async arquivoXmlPorSha(sha256) {
      const [a] = await tx
        .select()
        .from(xmlCteArquivos)
        .where(and(daEmpresa(xmlCteArquivos), eq(xmlCteArquivos.sha256, sha256)));
      return a ?? null;
    },

    async registrarArquivoXml(a) {
      const [r] = await tx
        .insert(xmlCteArquivos)
        .values({ empresaId, ...a })
        .onConflictDoUpdate({ target: [xmlCteArquivos.empresaId, xmlCteArquivos.sha256], set: a })
        .returning({ id: xmlCteArquivos.id });
      if (!r) throw new Error("Falha ao registrar o arquivo XML.");
      return r.id;
    },

    async itemXmlJaAplicado(sha256Xml) {
      const [i] = await tx
        .select({ id: xmlCteItens.id })
        .from(xmlCteItens)
        .where(
          and(
            daEmpresa(xmlCteItens),
            eq(xmlCteItens.sha256Xml, sha256Xml),
            eq(xmlCteItens.status, "sucesso"),
          ),
        )
        .limit(1);
      return i !== undefined;
    },

    async registrarItemXml(item) {
      await tx
        .insert(xmlCteItens)
        .values({ empresaId, ...item })
        .onConflictDoNothing();
    },

    async promoverItemXml(sha256Xml) {
      await tx.execute(sql`
        update ${xmlCteItens} set status = 'sucesso'
        where id = (
          select id from ${xmlCteItens}
          where empresa_id = ${empresaId} and sha256_xml = ${sha256Xml} and status = 'orfao'
          order by criado_em desc limit 1
        )
        and not exists (
          select 1 from ${xmlCteItens}
          where empresa_id = ${empresaId} and sha256_xml = ${sha256Xml} and status = 'sucesso'
        )`);
    },

    async ctePorChaveCte(chave) {
      const [c] = await tx
        .select()
        .from(ctes)
        .where(and(daEmpresa(ctes), eq(ctes.chave, chave)))
        .limit(1);
      return c ? comoCte(c) : null;
    },

    async ctesPorNumeroCte(numeroCte) {
      return tx
        .select({ id: ctes.id, cnpjDaFilial: filiais.cnpj })
        .from(ctes)
        .leftJoin(
          filiais,
          and(eq(filiais.empresaId, ctes.empresaId), eq(filiais.sigla, ctes.filial)),
        )
        .where(and(daEmpresa(ctes), eq(ctes.numeroCte, numeroCte)))
        .limit(2);
    },

    async ctesPorChaveNfe(chaveNfe) {
      const linhas = await tx
        .select({ id: ctes.id })
        .from(ctes)
        .where(
          and(
            daEmpresa(ctes),
            eq(ctes.chaveNfe, chaveNfe),
            isNull(ctes.chave),
            isNull(ctes.numeroCte),
          ),
        )
        .limit(2);
      return linhas.map((l) => l.id);
    },

    async ctePorId(id) {
      const [c] = await tx
        .select()
        .from(ctes)
        .where(and(daEmpresa(ctes), eq(ctes.id, id)));
      return c ? comoCte(c) : null;
    },

    async guardarOrfao(o, expiraEm) {
      await tx
        .insert(xmlCteOrfaos)
        .values({ empresaId, ...o, expiraEm })
        .onConflictDoNothing();
    },

    async expirarOrfaos(agora) {
      const feitos = await tx
        .update(xmlCteOrfaos)
        .set({ status: "expirado", atualizadoEm: agora })
        .where(
          and(
            daEmpresa(xmlCteOrfaos),
            eq(xmlCteOrfaos.status, "pendente"),
            lte(xmlCteOrfaos.expiraEm, agora),
          ),
        )
        .returning({ id: xmlCteOrfaos.id });
      return feitos.length;
    },

    async orfaosPendentes(limite) {
      return tx
        .select({
          id: xmlCteOrfaos.id,
          sha256Xml: xmlCteOrfaos.sha256Xml,
          nomeXml: xmlCteOrfaos.nomeXml,
          tipo: xmlCteOrfaos.tipo,
          chaveCte: xmlCteOrfaos.chaveCte,
          xmlConteudo: xmlCteOrfaos.xmlConteudo,
          tentativas: xmlCteOrfaos.tentativas,
        })
        .from(xmlCteOrfaos)
        .where(and(daEmpresa(xmlCteOrfaos), eq(xmlCteOrfaos.status, "pendente")))
        .orderBy(asc(xmlCteOrfaos.criadoEm))
        .limit(limite);
    },

    async marcarOrfao(id, casado, erro, agora) {
      await tx
        .update(xmlCteOrfaos)
        .set({
          tentativas: sql`${xmlCteOrfaos.tentativas} + 1`,
          ultimaTentativa: agora,
          ultimoErro: erro,
          atualizadoEm: agora,
          ...(casado ? { status: "casado" as const, casadoEm: agora } : {}),
        })
        .where(and(daEmpresa(xmlCteOrfaos), eq(xmlCteOrfaos.id, id)));
    },

    async registrarSincronizacao(s) {
      await tx.insert(xmlFtpSincronizacoes).values({ empresaId, ...s });
    },
  };
  return repo;
}

/** Limpeza de retenção, no contexto da Plataforma (todas as empresas). */
export function criarRepositorioDeRetencao(tx: Transacao): RepositorioDeRetencao {
  const apagadas = (r: { rowCount: number | null }) => r.rowCount ?? 0;
  return {
    async apagarLinhasAplicadasAntesDe(limite: Date) {
      // Linha sem CT-e (ex.: 306 de coleta) nunca é aplicada: sai pela data de importação.
      return apagadas(
        await tx.execute(sql`delete from ${ingestaoLinhas}
          where aplicado_em < ${limite} or (aplicado_em is null and numero is null and importado_em < ${limite})`),
      );
    },
    async apagarErrosAntesDe(limite: Date) {
      return apagadas(
        await tx.execute(sql`delete from ${ingestaoErros} where criado_em < ${limite}`),
      );
    },
    async apagarArquivosCiclosEAplicacoesAntesDe(limite: Date) {
      let n = apagadas(
        await tx.execute(sql`delete from ${ingestaoArquivos} where visto_em < ${limite}`),
      );
      n += apagadas(
        await tx.execute(
          sql`delete from ${ingestaoCiclos} where ultimo_arquivo_em < ${limite} and status in ('aplicado', 'descartado')`,
        ),
      );
      n += apagadas(
        await tx.execute(sql`delete from ${ingestaoAplicacoes} where iniciado_em < ${limite}`),
      );
      return n;
    },
    async apagarXmlAntesDe(limite: Date) {
      // Os itens saem em cascata com o arquivo.
      return apagadas(
        await tx.execute(sql`delete from ${xmlCteArquivos} where criado_em < ${limite}`),
      );
    },
    async apagarOrfaosResolvidosAntesDe(limite: Date) {
      return apagadas(
        await tx.execute(
          sql`delete from ${xmlCteOrfaos} where status in ('casado', 'expirado') and atualizado_em < ${limite}`,
        ),
      );
    },
    async apagarSincronizacoesAntesDe(limite: Date) {
      return apagadas(
        await tx.execute(sql`delete from ${xmlFtpSincronizacoes} where executado_em < ${limite}`),
      );
    },
    async apagar038Superadas(limite: Date, bloco: number) {
      let total = 0;
      for (;;) {
        const n = apagadas(
          await tx.execute(sql`delete from ${ingestaoLinhas} where id in (
            select l.id from ${ingestaoLinhas} l
            where l.relatorio = '038' and l.importado_em < ${limite} and l.numero is not null
              and exists (
                select 1 from ${ingestaoLinhas} n
                where n.empresa_id = l.empresa_id and n.relatorio = '038' and n.sigla = l.sigla
                  and n.numero = l.numero and n.importado_em > l.importado_em)
            limit ${bloco})`),
        );
        total += n;
        if (n < bloco) return total;
      }
    },
  };
}

/** Só a gravação do núcleo do CT-e (BI2 e webhook no worker): a mesma do repositório da ingestão. */
export function criarRepositorioCteNucleo(tx: Transacao, empresaId: string): RepositorioCteNucleo {
  const r = criarRepositorioIngestao(tx, empresaId);
  return {
    cadastrosDoNucleo: () => r.cadastrosDoNucleo(),
    ocorrenciasDosCtes: (ids) => r.ocorrenciasDosCtes(ids),
    inserirCtes: (novos) => r.inserirCtes(novos),
    atualizarCte: (id, campos) => r.atualizarCte(id, campos),
    registrarTrocaDePrevisao: (cteId, troca) => r.registrarTrocaDePrevisao(cteId, troca),
  };
}
