/**
 * Jobs de manutenção da ingestão: unidade pelo 455 (:08/:38) e limpeza com retenção (03:40 SP).
 * Spec 06 §3.5, §3.6.3 e §4.1; Q49 do dono (prazos de retenção).
 * origem: ctrcs_unidade_pelo_455, limpar_staging_038_superadas (sistema atual)
 */
import { filiaisProprias } from "@erp/dominio/nucleo";

import { type Registro455Csv } from "../../fontes/relatorios";
import { type LinhaGuardada, maisNovaPrimeiro, unidadePelo455 } from "../regras";
import { avisarProjecoes, type DependenciasDaAplicacao } from "./aplicar";
import { BLOCO } from "./ciclo";
import { regravarCte } from "./gravar-cte";
import { type RepositorioDeRetencao } from "./portas";

export const HORAS_DA_UNIDADE_PELO_455 = 48;

/** Filial e unidade de destino pelo último 455 das últimas 48 h. */
export async function unidadePelo455Recente(deps: DependenciasDaAplicacao): Promise<number> {
  const desde = new Date(deps.agora().getTime() - HORAS_DA_UNIDADE_PELO_455 * 3_600_000);
  const todas = await deps.executar((r) => r.chavesDesde("455csv", desde));
  let alterados = 0;
  for (let i = 0; i < todas.length; i += BLOCO) {
    const chaves = todas.slice(i, i + BLOCO);
    const mudaram = await deps.executar(async (r) => {
      const linhas = await r.linhasDasChaves("455csv", chaves);
      const ctes = await r.ctesDasChaves(chaves);
      if (ctes.length === 0) return [];
      const cad = await r.cadastrosDoNucleo();
      const proprias = new Set(filiaisProprias(cad.filiais));
      const ocorrencias = await r.ocorrenciasDosCtes(ctes.map((c) => c.id));
      const saida: string[] = [];
      for (const cte of ctes) {
        const doCte: LinhaGuardada<Registro455Csv>[] = linhas
          .filter((l) => l.sigla === cte.sigla && l.numero === cte.numero)
          .map((l) => ({
            id: l.id,
            loteId: l.loteId,
            importadoEm: l.importadoEm,
            dados: l.dados as Registro455Csv,
          }))
          .sort(maisNovaPrimeiro);
        const ultima = doCte[0];
        if (!ultima) continue;
        const campos = unidadePelo455(cte, ultima.dados, proprias);
        if (Object.keys(campos).length === 0) continue;
        const res = await regravarCte(
          r,
          cad,
          cte,
          campos,
          ocorrencias.get(cte.id) ?? [],
          deps.agora(),
        );
        if (res.tipo === "gravado") saida.push(`${cte.sigla}|${cte.numero}`);
      }
      return saida;
    });
    alterados += mudaram.length;
    await avisarProjecoes(deps.enfileirador, deps.empresaId, mudaram);
  }
  return alterados;
}

const DIA_MS = 86_400_000;

/** Retenção da ingestão (Q49), em todas as empresas. */
export const RETENCAO = {
  linhasAplicadasDias: 60,
  errosDias: 30,
  arquivosCiclosAplicacoesDias: 180,
  xmlDias: 180,
  orfaosResolvidosDias: 30,
  sincronizacoesFtpDias: 90,
  /** 038 superado (há linha mais nova do mesmo CT-e) sai depois de 7 dias (spec §3.5). */
  superadas038Dias: 7,
} as const;

export async function limparIngestao(
  repo: RepositorioDeRetencao,
  agora: Date,
): Promise<Record<string, number>> {
  const antes = (dias: number) => new Date(agora.getTime() - dias * DIA_MS);
  return {
    superadas038: await repo.apagar038Superadas(antes(RETENCAO.superadas038Dias), 20_000),
    linhas: await repo.apagarLinhasAplicadasAntesDe(antes(RETENCAO.linhasAplicadasDias)),
    erros: await repo.apagarErrosAntesDe(antes(RETENCAO.errosDias)),
    arquivosCiclosAplicacoes: await repo.apagarArquivosCiclosEAplicacoesAntesDe(
      antes(RETENCAO.arquivosCiclosAplicacoesDias),
    ),
    xml: await repo.apagarXmlAntesDe(antes(RETENCAO.xmlDias)),
    orfaos: await repo.apagarOrfaosResolvidosAntesDe(antes(RETENCAO.orfaosResolvidosDias)),
    sincronizacoes: await repo.apagarSincronizacoesAntesDe(antes(RETENCAO.sincronizacoesFtpDias)),
  };
}
