import { empresaEmOperacao } from "@erp/dominio/empresas";

/**
 * Empresa de uma execução da ingestão (rota pública, job): `?empresa=`, `x-empresa` ou corpo.
 * Spec 06 §0.1.
 * origem: src/lib/empresa-ingestao.ts decidirEmpresaIngestao (sistema atual)
 */
export type TipoIntegracao = "sftp" | "ssw_api" | "ssw_bi2" | "ssw_webhook" | "ahgora" | "xml_cte";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface EmpresaParaIngestao {
  id: string;
  slug: string;
  nome: string;
  status: string;
  /** Tipos de integração ligados (`ativo`). */
  integracoesAtivas: readonly string[];
}

export type DecisaoDeEmpresa =
  | { ok: true; empresa: EmpresaParaIngestao }
  | { ok: false; status: 400 | 403 | 404 | 409; motivo: string; erro: string };

export function decidirEmpresa(
  pedida: string | null,
  tipo: TipoIntegracao,
  empresas: readonly EmpresaParaIngestao[],
): DecisaoDeEmpresa {
  const ligada = (e: EmpresaParaIngestao) => e.integracoesAtivas.includes(tipo);
  const texto = pedida?.trim() ?? "";
  if (texto !== "") {
    const alvo = texto.toLowerCase();
    const e = empresas.find((x) =>
      RE_UUID.test(texto) ? x.id.toLowerCase() === alvo : x.slug.toLowerCase() === alvo,
    );
    if (!e) {
      return {
        ok: false,
        status: 404,
        motivo: "empresa_desconhecida",
        erro: `Empresa "${texto}" não encontrada.`,
      };
    }
    if (!empresaEmOperacao(e.status)) {
      return {
        ok: false,
        status: 403,
        motivo: "empresa_inativa",
        erro: `Empresa ${e.nome} está ${e.status}: a ingestão não roda.`,
      };
    }
    if (!ligada(e)) {
      return {
        ok: false,
        status: 409,
        motivo: "integracao_desligada",
        erro: `A integração ${tipo} da empresa ${e.nome} está desligada.`,
      };
    }
    return { ok: true, empresa: e };
  }
  const elegiveis = empresas.filter((e) => empresaEmOperacao(e.status) && ligada(e));
  const [unica] = elegiveis;
  if (!unica) {
    return {
      ok: false,
      status: 409,
      motivo: "integracao_desligada",
      erro: `Nenhuma empresa com a integração ${tipo} ligada.`,
    };
  }
  if (elegiveis.length > 1) {
    return {
      ok: false,
      status: 400,
      motivo: "empresa_obrigatoria",
      erro: `Mais de uma empresa com a integração ${tipo} ligada: informe ?empresa=<slug>.`,
    };
  }
  return { ok: true, empresa: unica };
}

/** Empresas que rodam um job agendado: status que ingere e integração ligada. */
export function empresasQueIngerem(
  empresas: readonly EmpresaParaIngestao[],
  tipo: TipoIntegracao,
): EmpresaParaIngestao[] {
  return empresas.filter((e) => empresaEmOperacao(e.status) && e.integracoesAtivas.includes(tipo));
}
