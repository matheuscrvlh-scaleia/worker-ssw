/**
 * Projeções do Romaneio no banco (worker e migrador): lê as linhas 036/306/038/455 guardadas e
 * as projeções gravadas dos CT-e (inclusive o conferente da tela Ocorrências), e regrava as que
 * mudaram. Tudo por chave (sigla, número), em conjunto.
 */
import { type Transacao } from "@erp/db";
import {
  cteDadosRelatorios,
  ingestaoArquivos,
  ingestaoLinhas,
  romaneioConferenteCte,
  romaneioCteAtual,
  romaneioSaidasCte,
  romaneioViagensCte,
} from "@erp/db/schema";
import {
  linha036De,
  linha038De,
  linha306De,
  linha455De,
} from "@erp/dominio/romaneio/linhas-de-relatorio";
import {
  type ChaveCte,
  chaveDoCte,
  type DadosRelatorios,
  type LinhasDoCte,
  type RepositorioProjecoesRomaneio,
  type RomaneioAtual,
  type ViagemProjetada,
} from "@erp/dominio/romaneio/projecoes";
import { and, type AnyColumn, asc, inArray, type SQL, sql } from "drizzle-orm";

const RELATORIOS = ["036", "306", "038", "455csv"] as const;

/** Linhas por insert (abaixo do limite de parâmetros do Postgres). */
const LOTE_DE_INSERT = 1000;

/** `(numero, sigla)` da tabela está entre as chaves dadas (arrays como parâmetro único). */
function dasChaves(t: { sigla: AnyColumn; numero: AnyColumn }, chaves: readonly ChaveCte[]): SQL {
  return sql`(${t.numero}, ${t.sigla}) in (select * from unnest(
    ${sql.param(chaves.map((c) => c.numero))}::text[], ${sql.param(chaves.map((c) => c.sigla))}::text[]))`;
}

const decimal = (v: number | null) => (v === null ? null : v.toFixed(2));
const numero = (v: string | null) => (v === null ? null : Number(v));

function emLotes<T>(itens: readonly T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += LOTE_DE_INSERT) {
    lotes.push(itens.slice(i, i + LOTE_DE_INSERT));
  }
  return lotes;
}

function agrupar<T extends ChaveCte, V>(linhas: readonly T[], valor: (l: T) => V) {
  const porCte = new Map<string, V[]>();
  for (const l of linhas) {
    const k = chaveDoCte(l);
    porCte.set(k, [...(porCte.get(k) ?? []), valor(l)]);
  }
  return porCte;
}

function atualDaLinha(r: typeof romaneioCteAtual.$inferSelect): RomaneioAtual {
  return {
    placa: r.placa,
    motorista: r.motorista,
    r036: r.tem036
      ? {
          romaneio: r.romaneio,
          situacao: r.situacao,
          placa: r.placa036,
          motorista: r.motorista036,
          ajudante: r.ajudante,
          ajudante2: r.ajudante2,
          ajudante3: r.ajudante3,
          codOcorr: r.codOcorr036,
          descOcorr: r.descOcorr036,
          dataOcorr: r.dataOcorr036,
          dataEmissao: r.dataEmissao036,
        }
      : null,
    r306: r.tem306 ? { placa: r.placa306, motorista: r.motorista306, data: r.data306 } : null,
  };
}

function dadosDaLinha(r: typeof cteDadosRelatorios.$inferSelect): DadosRelatorios {
  return {
    valorMercadoria: numero(r.valorMercadoria),
    r038: r.tem038
      ? {
          setor: r.setor,
          bairro: r.bairro,
          endereco: r.endereco,
          cep: r.cep,
          valorMercadoria: numero(r.valorMercadoria038),
        }
      : null,
    valorMercadoria455: numero(r.valorMercadoria455),
  };
}

/** `empresaId`: a empresa do contexto do job (o RLS confere que é a mesma da sessão). */
export function criarRepositorioProjecoesRomaneio(
  tx: Transacao,
  empresaId: string | null,
): RepositorioProjecoesRomaneio {
  return {
    linhasDosCtes: async (chaves) => {
      const linhas = await tx
        .select({
          relatorio: ingestaoLinhas.relatorio,
          sigla: ingestaoLinhas.sigla,
          numero: ingestaoLinhas.numero,
          dados: ingestaoLinhas.dados,
          importadoEm: ingestaoLinhas.importadoEm,
        })
        .from(ingestaoLinhas)
        .where(
          and(
            inArray(ingestaoLinhas.relatorio, [...RELATORIOS]),
            dasChaves(ingestaoLinhas, chaves),
            sql`not exists (select 1 from ${ingestaoArquivos}
              where ${ingestaoArquivos.id} = ${ingestaoLinhas.arquivoId}
                and ${ingestaoArquivos.status} <> 'importado')`,
          ),
        );
      const porCte = new Map<string, LinhasDoCte>();
      for (const l of linhas) {
        if (l.sigla === null || l.numero === null) continue;
        const k = chaveDoCte({ sigla: l.sigla, numero: l.numero });
        const atual = porCte.get(k) ?? { l036: [], l306: [], l038: [], l455: [] };
        porCte.set(k, {
          l036:
            l.relatorio === "036"
              ? [...atual.l036, linha036De(l.dados, l.importadoEm)]
              : atual.l036,
          l306:
            l.relatorio === "306"
              ? [...atual.l306, linha306De(l.dados, l.importadoEm)]
              : atual.l306,
          l038:
            l.relatorio === "038"
              ? [...atual.l038, linha038De(l.dados, l.importadoEm)]
              : atual.l038,
          l455:
            l.relatorio === "455csv"
              ? [...atual.l455, linha455De(l.dados, l.importadoEm)]
              : atual.l455,
        });
      }
      return porCte;
    },

    gravadas: async (chaves) => {
      const v = romaneioViagensCte;
      const [viagens, saidas, atuais, dados, conferentes] = await Promise.all([
        tx.select().from(v).where(dasChaves(v, chaves)),
        tx.select().from(romaneioSaidasCte).where(dasChaves(romaneioSaidasCte, chaves)),
        tx.select().from(romaneioCteAtual).where(dasChaves(romaneioCteAtual, chaves)),
        tx.select().from(cteDadosRelatorios).where(dasChaves(cteDadosRelatorios, chaves)),
        tx.select().from(romaneioConferenteCte).where(dasChaves(romaneioConferenteCte, chaves)),
      ]);
      return {
        viagens: agrupar(viagens, (r): ViagemProjetada => ({
          romaneio: r.romaneio,
          situacao: r.situacao,
          dataSaida: r.dataSaida,
          horaSaida: r.horaSaida,
          placa: r.placa,
          motorista: r.motorista,
          motoristaNormalizado: r.motoristaNormalizado,
          ajudante: r.ajudante,
          ajudante2: r.ajudante2,
          ajudante3: r.ajudante3,
          primeira: r.primeira,
          ultima: r.ultima,
          proximaSaida: r.proximaSaida,
        })),
        saidas: agrupar(saidas, (r) => r.dataSaida),
        atuais: new Map(atuais.map((r) => [chaveDoCte(r), atualDaLinha(r)])),
        dados: new Map(dados.map((r) => [chaveDoCte(r), dadosDaLinha(r)])),
        conferentes: new Map(
          conferentes.map((r) => [
            chaveDoCte(r),
            { conferente: r.conferente, romaneio: r.romaneio },
          ]),
        ),
      };
    },

    gravar: async (projecoes) => {
      if (empresaId === null) throw new Error("projeções do romaneio exigem o contexto da empresa");
      const chaves = projecoes.map((p) => p.chave);
      await tx.delete(romaneioViagensCte).where(dasChaves(romaneioViagensCte, chaves));
      await tx.delete(romaneioSaidasCte).where(dasChaves(romaneioSaidasCte, chaves));
      await tx.delete(romaneioCteAtual).where(dasChaves(romaneioCteAtual, chaves));
      await tx.delete(cteDadosRelatorios).where(dasChaves(cteDadosRelatorios, chaves));
      await tx.delete(romaneioConferenteCte).where(dasChaves(romaneioConferenteCte, chaves));

      const viagens = projecoes.flatMap((p) =>
        p.viagens.map((v) => ({ empresaId, ...p.chave, ...v })),
      );
      const saidas = projecoes.flatMap((p) =>
        p.saidas.map((dataSaida) => ({ empresaId, ...p.chave, dataSaida })),
      );
      const atuais = projecoes.flatMap(({ chave, atual: a }) =>
        a
          ? [
              {
                empresaId,
                ...chave,
                placa: a.placa,
                motorista: a.motorista,
                tem036: a.r036 !== null,
                romaneio: a.r036?.romaneio ?? null,
                situacao: a.r036?.situacao ?? null,
                placa036: a.r036?.placa ?? null,
                motorista036: a.r036?.motorista ?? null,
                ajudante: a.r036?.ajudante ?? null,
                ajudante2: a.r036?.ajudante2 ?? null,
                ajudante3: a.r036?.ajudante3 ?? null,
                codOcorr036: a.r036?.codOcorr ?? null,
                descOcorr036: a.r036?.descOcorr ?? null,
                dataOcorr036: a.r036?.dataOcorr ?? null,
                dataEmissao036: a.r036?.dataEmissao ?? null,
                tem306: a.r306 !== null,
                placa306: a.r306?.placa ?? null,
                motorista306: a.r306?.motorista ?? null,
                data306: a.r306?.data ?? null,
              },
            ]
          : [],
      );
      const dados = projecoes.flatMap(({ chave, dados: d }) =>
        d
          ? [
              {
                empresaId,
                ...chave,
                valorMercadoria: decimal(d.valorMercadoria),
                tem038: d.r038 !== null,
                setor: d.r038?.setor ?? null,
                bairro: d.r038?.bairro ?? null,
                endereco: d.r038?.endereco ?? null,
                cep: d.r038?.cep ?? null,
                valorMercadoria038: decimal(d.r038?.valorMercadoria ?? null),
                valorMercadoria455: decimal(d.valorMercadoria455),
              },
            ]
          : [],
      );
      const conferentes = projecoes.flatMap(({ chave, conferente }) =>
        conferente ? [{ empresaId, ...chave, ...conferente }] : [],
      );
      for (const lote of emLotes(viagens)) await tx.insert(romaneioViagensCte).values(lote);
      for (const lote of emLotes(saidas)) await tx.insert(romaneioSaidasCte).values(lote);
      for (const lote of emLotes(atuais)) await tx.insert(romaneioCteAtual).values(lote);
      for (const lote of emLotes(dados)) await tx.insert(cteDadosRelatorios).values(lote);
      for (const lote of emLotes(conferentes)) await tx.insert(romaneioConferenteCte).values(lote);
    },

    chavesComLinhas: async (apos, limite) => {
      const l = ingestaoLinhas;
      const linhas = await tx
        .selectDistinct({ numero: l.numero, sigla: l.sigla })
        .from(l)
        .where(
          and(
            inArray(l.relatorio, [...RELATORIOS]),
            sql`${l.sigla} is not null and ${l.numero} is not null`,
            apos ? sql`(${l.numero}, ${l.sigla}) > (${apos.numero}, ${apos.sigla})` : undefined,
          ),
        )
        .orderBy(asc(l.numero), asc(l.sigla))
        .limit(limite);
      return linhas.flatMap((r) =>
        r.sigla !== null && r.numero !== null ? [{ sigla: r.sigla, numero: r.numero }] : [],
      );
    },
  };
}
