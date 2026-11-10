/**
 * Regras na gravação de ocorrência (antes eram gatilhos em `ocorrencias` e `codigos_ocorrencia`)
 * e o que a ocorrência gravada muda no CT-e (embarque, emissão pela 80).
 */
import { ErroDeNegocio } from "../erros";
import {
  type CatalogoDeCodigos,
  CODIGO_ANCORA_EMISSAO,
  type CodigoCadastrado,
  CODIGOS_EMBARQUE,
  ehCodigoValido,
  type ProcessoSsw,
  type Responsavel,
  type TipoSsw,
} from "./codigos";
import { foraDeQuarentena, type OcorrenciaDoCte, ORIGEM_TRACKINGDANFE } from "./ocorrencia";
import { type DataIso, diaSp, menosDias } from "./tempo";
import { vazioAposTrim } from "./texto";

/** Evento do trackingdanfe mais antigo que isto antes da criação do CT-e é suspeito. */
const DIAS_LIMITE_TRACKINGDANFE = 400;

/** Ocorrência que vai ser criada, como a ingestão recebeu. */
export interface OcorrenciaRecebida {
  codigo: number;
  dataHora: Date;
  origem: string;
  /** Responsável informado na entrada; sem ele vale o do cadastro. */
  responsavel: Responsavel | null;
  /** Valor recebido; a regra só liga a quarentena, nunca desliga. */
  quarentena: boolean;
}

/** Domínio e filial que o trackingdanfe trouxe no payload. */
interface PayloadTrackingdanfe {
  dominio: string | null;
  filial: string | null;
}

interface EmpresaDaOcorrencia {
  /** `empresas.dominio_ssw` (FR = FRT). */
  dominioSsw: string | null;
  filiaisProprias: ReadonlySet<string>;
}

type OcorrenciaPreparada =
  | { tipo: "gravar"; quarentena: boolean; responsavel: Responsavel; penaliza: boolean }
  | { tipo: "descartar"; motivo: string };

/**
 * Prepara a criação de uma ocorrência, na ordem de hoje: quarentena → responsável/penaliza →
 * domínio do trackingdanfe. O código já precisa estar no catálogo (`codigoRecebidoSemCadastro`).
 * Depois de gravar, o chamador recalcula o CT-e (`prepararGravacaoDoCte`).
 */
export function prepararOcorrencia(entrada: {
  ocorrencia: OcorrenciaRecebida;
  cte: { dataEmissao: DataIso; criadoEm: Date };
  catalogo: CatalogoDeCodigos;
  empresa: EmpresaDaOcorrencia;
  /** Só para origem trackingdanfe; `null` = payload sem domínio nem filial. */
  trackingdanfe: PayloadTrackingdanfe | null;
}): OcorrenciaPreparada {
  const { ocorrencia, cte, catalogo, empresa } = entrada;
  const cadastro = catalogo.get(ocorrencia.codigo);
  if (cadastro === undefined) {
    throw new ErroDeNegocio(
      "ENTRADA_INVALIDA",
      `Código de ocorrência ${ocorrencia.codigo} sem cadastro na empresa.`,
    );
  }
  if (ocorrencia.origem === ORIGEM_TRACKINGDANFE) {
    const motivo = motivoDeDescarteDoTrackingdanfe(entrada.trackingdanfe, empresa);
    if (motivo !== null) return { tipo: "descartar", motivo };
  }
  return {
    tipo: "gravar",
    quarentena: ocorrencia.quarentena || entraEmQuarentena(ocorrencia, cte),
    ...responsavelEPenaliza(ocorrencia, cadastro),
  };
}

/**
 * Dia (Brasília) antes da emissão; ou trackingdanfe mais de 400 dias antes da criação do CT-e.
 * origem: guard_data_ocorrencia (sistema atual)
 */
export function entraEmQuarentena(
  ocorrencia: Pick<OcorrenciaRecebida, "dataHora" | "origem">,
  cte: { dataEmissao: DataIso; criadoEm: Date },
): boolean {
  if (diaSp(ocorrencia.dataHora) < cte.dataEmissao) return true;
  return (
    ocorrencia.origem === ORIGEM_TRACKINGDANFE &&
    ocorrencia.dataHora < menosDias(cte.criadoEm, DIAS_LIMITE_TRACKINGDANFE)
  );
}

/**
 * Responsável recebido ou o do cadastro; `penaliza` sempre do cadastro.
 * origem: fill_ocorrencia_penaliza (sistema atual)
 */
function responsavelEPenaliza(
  ocorrencia: OcorrenciaRecebida,
  cadastro: CodigoCadastrado,
): { responsavel: Responsavel; penaliza: boolean } {
  return {
    responsavel: ocorrencia.responsavel ?? cadastro.responsavel,
    penaliza: cadastro.penaliza,
  };
}

/**
 * Trackingdanfe só entra com o domínio da empresa; sem domínio, com filial própria (sigla exata).
 * Domínio diferente descarta mesmo com filial própria. Webhook do SSW é confiável e não passa aqui.
 * origem: validar_ocorrencia_dominio (sistema atual)
 */
function motivoDeDescarteDoTrackingdanfe(
  payload: PayloadTrackingdanfe | null,
  empresa: EmpresaDaOcorrencia,
): string | null {
  const dominio = payload?.dominio ?? null;
  const filial = payload?.filial ?? null;
  if (dominio !== null && dominio === empresa.dominioSsw) return null;
  if (dominio === null && filial !== null && empresa.filiaisProprias.has(filial)) return null;
  return `ocorrencia_dominio_invalido: dominio=${dominio ?? ""} filial=${filial ?? ""}`;
}

// --- Catálogo de códigos ---------------------------------------------------------------------

export interface CodigoNovo extends CodigoCadastrado {
  letraResponsavel: string;
  pendenteClassificacao: boolean;
  ativo: boolean;
}

/**
 * Código que chegou do SSW e não está no catálogo: entra pendente de classificação, sem tipo.
 * Código fora de 0–99 não entra (`null`). A empresa é obrigatória no caso de uso.
 * origem: garantir_codigo_ocorrencia (sistema atual)
 */
export function codigoRecebidoSemCadastro(
  codigo: number,
  descricao: string | null,
): CodigoNovo | null {
  if (!ehCodigoValido(codigo)) return null;
  return {
    codigo,
    descricao: vazioAposTrim(descricao) ?? "Recebido via SSW",
    tipoSsw: null,
    processoSsw: null,
    responsavel: "outro",
    letraResponsavel: "O",
    penaliza: false,
    pendenteClassificacao: true,
    ativo: true,
  };
}

/**
 * Responsável, letra e penaliza derivados do tipo SSW ao **cadastrar** um código (na edição o
 * admin ajusta à mão). Sem tipo, `null` = manter o recebido.
 * origem: codigos_derivar_responsavel (sistema atual)
 */
export function derivarResponsavelPeloTipo(
  tipoSsw: TipoSsw | null,
  processoSsw: ProcessoSsw | null,
): { responsavel: Responsavel; letraResponsavel: string; penaliza: boolean } | null {
  if (tipoSsw === null) return null;
  if (tipoSsw === "PENDENCIA_TRANSPORTADORA") {
    return { responsavel: "FR", letraResponsavel: "F", penaliza: true };
  }
  if (tipoSsw === "PENDENCIA_CLIENTE") {
    return processoSsw === "ENTREGA" || processoSsw === "REENTREGA"
      ? { responsavel: "destinatario", letraResponsavel: "D", penaliza: false }
      : { responsavel: "cliente", letraResponsavel: "C", penaliza: false };
  }
  return { responsavel: "sistema", letraResponsavel: "S", penaliza: false };
}

/**
 * O que a alteração de um código exige: regravar responsável/penaliza em todas as ocorrências da
 * empresa com o código, e recalcular os CT-e que têm esse código quando muda o que entra na
 * situação (tipo SSW ou descrição — Q20 do dono; hoje isso só acontecia por tabela).
 * origem: propagate_codigo_changes (sistema atual)
 */
export function efeitoDaAlteracaoDeCodigo(
  antes: CodigoCadastrado,
  depois: CodigoCadastrado,
): {
  regravarOcorrencias: { responsavel: Responsavel; penaliza: boolean } | null;
  recalcularCtes: boolean;
} {
  const mudouResponsabilidade =
    antes.responsavel !== depois.responsavel || antes.penaliza !== depois.penaliza;
  return {
    regravarOcorrencias: mudouResponsabilidade
      ? { responsavel: depois.responsavel, penaliza: depois.penaliza }
      : null,
    recalcularCtes: antes.tipoSsw !== depois.tipoSsw || antes.descricao !== depois.descricao,
  };
}

// --- Efeitos da ocorrência no CT-e -----------------------------------------------------------

/**
 * Menor dia (Brasília) das 82/85 do CT-e; `null` = sem embarque (mantém o gravado). Quarentena
 * fora (Q21 do dono).
 * origem: sync_data_embarque_from_ocorrencia (sistema atual)
 */
export function dataEmbarque(ocorrencias: readonly OcorrenciaDoCte[]): DataIso | null {
  return menorDia(foraDeQuarentena(ocorrencias).filter((o) => CODIGOS_EMBARQUE.has(o.codigo)));
}

/**
 * A 80 válida mais antiga antecipa a emissão (nunca adia). Trackingdanfe muito anterior à
 * criação do CT-e não vale.
 * origem: sync_data_emissao_from_ocorrencia_80 (sistema atual)
 */
export function emissaoAncoradaNo80(
  cte: { dataEmissao: DataIso; criadoEm: Date },
  ocorrencias: readonly OcorrenciaDoCte[],
): DataIso {
  const limite = menosDias(cte.criadoEm, DIAS_LIMITE_TRACKINGDANFE);
  const validas = foraDeQuarentena(ocorrencias).filter(
    (o) =>
      o.codigo === CODIGO_ANCORA_EMISSAO &&
      (o.origem !== ORIGEM_TRACKINGDANFE || o.dataHora >= limite),
  );
  const menor = menorDia(validas);
  return menor !== null && menor < cte.dataEmissao ? menor : cte.dataEmissao;
}

function menorDia(ocorrencias: readonly OcorrenciaDoCte[]): DataIso | null {
  let menor: DataIso | null = null;
  for (const o of ocorrencias) {
    const dia = diaSp(o.dataHora);
    if (menor === null || dia < menor) menor = dia;
  }
  return menor;
}

/**
 * Nome da cidade em textos do webhook como "Chegada na unidade SAO JOAO DE MERITI em 02/07/26,
 * 01:14h." (sensível a maiúsculas; guloso: vai até o último " em <dígito>"). O chamador busca a
 * filial em `filiais_apelidos` pelo nome devolvido (igualdade exata, empresa do CT-e).
 * origem: filial_do_complemento (sistema atual)
 */
export function cidadeDoComplemento(complemento: string | null): string | null {
  const nome = /unidade\s+(.+)\s+em\s+\d/.exec(complemento ?? "")?.[1];
  return nome === undefined ? null : nome.replace(/^ +| +$/g, "").toUpperCase();
}
