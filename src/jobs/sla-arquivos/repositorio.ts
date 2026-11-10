import { type Transacao } from "@erp/db";
import { sql } from "drizzle-orm";

import { type RepositorioSlaArquivos } from "./job";

/** Gravação em lotes: uma instrução por lote, com os valores num parâmetro JSON só. */
const TAMANHO_DO_LOTE = 1000;

const textoOuNulo = (v: unknown): string | null => (typeof v === "string" ? v : null);
const booleanoOuNulo = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
/** timestamptz chega como Date; a consulta já exige a coluna preenchida. */
function instante(v: unknown): Date {
  if (v instanceof Date) return v;
  throw new Error("data_entrega_realizada sem valor num candidato do SLA");
}

export function criarRepositorioSlaArquivos(tx: Transacao): RepositorioSlaArquivos {
  return {
    feriados: async () =>
      (
        await tx.execute(sql`select data::text as data, tipo::text as tipo from erp.feriados`)
      ).rows.map((r) => ({ data: String(r["data"]), tipo: String(r["tipo"]) })),

    // origem: calcular_sla_arquivos (sistema atual), CTE dos candidatos
    candidatos: async (empresaId, desde) => {
      const { rows } = await tx.execute(sql`
        select c.id::text as id, c.data_prevista_entrega::text as data_prevista,
               c.data_entrega_realizada as data_entrega, c.performance_dias, c.no_prazo,
               c.responsabilidade_cliente, c.fonte_performance, c.campos_ssw,
               exists (
                 select 1 from erp.ocorrencias o
                 join erp.codigos_ocorrencia k
                   on k.empresa_id = o.empresa_id and k.codigo = o.codigo
                 where o.cte_id = c.id and k.tipo_ssw = 'PENDENCIA_CLIENTE'
               ) as tem_pendencia_cliente
        from erp.ctes c
        where c.empresa_id = ${empresaId}
          and c.data_emissao >= ${desde}::date
          and c.data_prevista_entrega >= c.data_emissao
          and c.data_entrega_realizada is not null
          and 'data_entrega_realizada' = any(c.campos_ssw)`);
      return rows.map((r) => ({
        id: String(r["id"]),
        dataPrevista: String(r["data_prevista"]),
        dataEntrega: instante(r["data_entrega"]),
        temPendenciaCliente: r["tem_pendencia_cliente"] === true,
        performanceDias: r["performance_dias"] === null ? null : Number(r["performance_dias"]),
        noPrazo: booleanoOuNulo(r["no_prazo"]),
        responsabilidadeCliente: booleanoOuNulo(r["responsabilidade_cliente"]),
        fontePerformance: textoOuNulo(r["fonte_performance"]),
        camposSsw: Array.isArray(r["campos_ssw"]) ? r["campos_ssw"].map(String) : [],
      }));
    },

    gravar: async (alterados, agora) => {
      for (let i = 0; i < alterados.length; i += TAMANHO_DO_LOTE) {
        const lote = alterados.slice(i, i + TAMANHO_DO_LOTE).map((a) => ({
          id: a.id,
          performance_dias: a.performanceDias,
          no_prazo: a.noPrazo,
          responsabilidade_cliente: a.responsabilidadeCliente,
          fonte_performance: a.fontePerformance,
          campos_ssw: a.camposSsw,
        }));
        await tx.execute(sql`
          update erp.ctes c
          set performance_dias = v.performance_dias, no_prazo = v.no_prazo,
              responsabilidade_cliente = v.responsabilidade_cliente,
              fonte_performance = v.fonte_performance, campos_ssw = v.campos_ssw,
              atualizado_em = ${agora}
          from jsonb_to_recordset(${JSON.stringify(lote)}::jsonb) as v(
            id uuid, performance_dias int, no_prazo boolean, responsabilidade_cliente boolean,
            fonte_performance text, campos_ssw text[])
          where c.id = v.id`);
      }
    },
  };
}
