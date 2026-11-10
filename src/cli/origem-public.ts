/**
 * Origem da reconstrução inicial (virada): a staging do `public` do sistema atual, com TODO o
 * histórico acumulado, e não só os 60 dias levados para `erp.ingestao_linhas`. Sem isso a virada
 * perde as viagens antigas (as matviews de hoje leem a staging inteira).
 *
 * Movido de erp-ssw/apps/migrador/src/passos/projecoes.ts (passo `recalcular-projecoes`, commit
 * 94fc9e6). Só lê: a sessão abre com `default_transaction_read_only = on` e todo SQL daqui é
 * `select`. Nada é gravado no `public`.
 */
import { type Linha036 } from "@erp/dominio/romaneio/hoje";
import { linha036De, linha038De, linha306De } from "@erp/dominio/romaneio/linhas-de-relatorio";
import {
  type ChaveCte,
  chaveDoCte,
  type Linha038,
  type Linha306,
  type Linha455,
  type LinhasDoCte,
  type RepositorioProjecoesRomaneio,
} from "@erp/dominio/romaneio/projecoes";
import { Client } from "pg";

/** Projeto Supabase de produção: só com `--confirmar-producao`. */
export const PROJETO_DE_PRODUCAO = "quyrhwmfbqikkpmiivuq";

export const ehProducao = (url: string) => url.includes(PROJETO_DE_PRODUCAO);

/** Consulta só de leitura na origem (`$1`, `$2`... como no `pg`). */
export interface OrigemDaStaging {
  consultar<T extends object>(sql: string, parametros: readonly unknown[]): Promise<T[]>;
}

/** O pedaço do `pg.Client` usado aqui (os testes passam um falso). */
export interface ClienteDaOrigem {
  connect(): Promise<unknown>;
  query(sql: string, parametros?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/** Abre a origem já em modo só leitura; nenhuma consulta roda antes disso. */
export async function abrirOrigem(
  url: string,
  criarCliente: (url: string) => ClienteDaOrigem = (connectionString) =>
    new Client({ connectionString, application_name: "worker-ssw-reconstrucao" }),
): Promise<OrigemDaStaging & { encerrar(): Promise<void> }> {
  const cliente = criarCliente(url);
  await cliente.connect();
  await cliente.query("SET default_transaction_read_only = on");
  return {
    // As colunas de cada linha são as do `select` de quem chama (aqui mesmo, neste arquivo).
    consultar: async <T extends object>(sql: string, parametros: readonly unknown[]) =>
      (await cliente.query(sql, [...parametros])).rows as T[],
    encerrar: () => cliente.end(),
  };
}

/** Colunas de controle da staging que não fazem parte do dado da linha. */
const CONTROLE =
  "array['id', 'lote_id', 'importado_em', 'arquivo_origem', 'linha_bruta', 'dado_hash', 'empresa_id', 'criado_em', 'numero_ctrc_norm']";

interface LinhaDaStaging {
  sigla: string;
  numero: string;
  importado_em: string;
  dados: unknown;
}

/** Todos os CT-e (sigla + número) com linha 036/306/038/455 na staging da empresa. */
export function chavesDaOrigem(origem: OrigemDaStaging, empresaId: string): Promise<ChaveCte[]> {
  return origem.consultar<ChaveCte>(
    `select numero, sigla from (
       select public.ssw_num_ctrc(ctrc) as numero, public.ssw_sigla_ctrc(ctrc) as sigla
         from public.staging_036_romaneios where empresa_id = $1
       union
       select numero_ctrc_norm, public.ssw_sigla_ctrc(ctrc_coleta)
         from public.staging_306_ssw_mobile where empresa_id = $1
       union
       select public.ssw_num_ctrc(ctrc), public.ssw_sigla_ctrc(ctrc)
         from public.staging_038_ctrcs_pendentes where empresa_id = $1
       union
       select public.ssw_num_ctrc(ctrc), public.ssw_sigla_ctrc(ctrc)
         from public.staging_455_ctrcs_expedidos where empresa_id = $1
     ) k
     where numero is not null and sigla is not null
     order by numero, sigla`,
    [empresaId],
  );
}

/** Linhas 036/306/038/455 das chaves, lidas da staging do `public` (índice pelo número). */
export async function linhasDaOrigem(
  origem: OrigemDaStaging,
  empresaId: string,
  chaves: readonly ChaveCte[],
): Promise<Map<string, LinhasDoCte>> {
  const numeros = [...new Set(chaves.map((c) => c.numero))];
  const pedidas = new Set(chaves.map(chaveDoCte));
  const ler = (tabela: string, campo: string, numero: string) =>
    origem.consultar<LinhaDaStaging>(
      `select public.ssw_sigla_ctrc(o.${campo}) as sigla, ${numero} as numero,
              to_json(o.importado_em) #>> '{}' as importado_em,
              (to_jsonb(o) - ${CONTROLE}) as dados
         from public.${tabela} o
        where o.empresa_id = $1 and ${numero} = any($2::text[])`,
      [empresaId, numeros],
    );
  const [l036, l306, l038, l455] = await Promise.all([
    ler("staging_036_romaneios", "ctrc", "public.ssw_num_ctrc(o.ctrc)"),
    ler("staging_306_ssw_mobile", "ctrc_coleta", "o.numero_ctrc_norm"),
    ler("staging_038_ctrcs_pendentes", "ctrc", "public.ssw_num_ctrc(o.ctrc)"),
    ler("staging_455_ctrcs_expedidos", "ctrc", "public.ssw_num_ctrc(o.ctrc)"),
  ]);
  const porCte = new Map<
    string,
    { l036: Linha036[]; l306: Linha306[]; l038: Linha038[]; l455: Linha455[] }
  >();
  const doCte = (l: LinhaDaStaging) => {
    const k = chaveDoCte(l);
    if (!pedidas.has(k)) return null;
    const atual = porCte.get(k) ?? { l036: [], l306: [], l038: [], l455: [] };
    porCte.set(k, atual);
    return atual;
  };
  const em = (l: LinhaDaStaging) => new Date(l.importado_em);
  for (const l of l036) doCte(l)?.l036.push(linha036De(l.dados, em(l)));
  for (const l of l306) doCte(l)?.l306.push(linha306De(l.dados, em(l)));
  for (const l of l038) doCte(l)?.l038.push(linha038De(l.dados, em(l)));
  // O valor da mercadoria do 455 vem do espelho no formato antigo, como na matview de hoje.
  for (const l of l455) {
    const valor: unknown =
      typeof l.dados === "object" && l.dados !== null
        ? Reflect.get(l.dados, "valor_mercadoria")
        : null;
    doCte(l)?.l455.push({
      valorMercadoria: typeof valor === "number" ? valor : null,
      importadoEm: em(l),
    });
  }
  return porCte;
}

/**
 * O repositório das projeções no `erp` (onde grava), com as linhas e as chaves lidas da staging
 * do `public` (lista de chaves carregada uma vez por empresa).
 */
export function comLinhasDaOrigem(
  repo: RepositorioProjecoesRomaneio,
  origem: OrigemDaStaging,
  empresaId: string,
  chaves: readonly ChaveCte[],
): RepositorioProjecoesRomaneio {
  const posicao = new Map(chaves.map((c, i) => [chaveDoCte(c), i]));
  return {
    gravadas: (c) => repo.gravadas(c),
    gravar: (p) => repo.gravar(p),
    linhasDosCtes: (pedidas) => linhasDaOrigem(origem, empresaId, pedidas),
    chavesComLinhas: (apos, limite) => {
      const inicio = apos ? (posicao.get(chaveDoCte(apos)) ?? -1) + 1 : 0;
      return Promise.resolve(chaves.slice(inicio, inicio + limite));
    },
  };
}
