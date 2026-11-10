/**
 * Cadastros que o núcleo consulta: filiais (cidade, próprias) e CNPJs da própria empresa.
 */
import { somenteDigitos } from "./texto";

/** Mesma ordem do `ORDER BY` do banco (collation en_US). */
const ORDEM_DO_BANCO = new Intl.Collator("en-US", { sensitivity: "variant" });

/** Linha de `filiais` da empresa (o que o núcleo lê). */
export interface FilialCadastrada {
  sigla: string;
  cidade: string | null;
  uf: string | null;
  propria: boolean;
}

/**
 * Cidade/UF da filial do CT-e (sigla sem diferenciar caixa e espaços). Só troca se a filial
 * existe e tem cidade; a UF vem junto mesmo nula. Senão mantém o que veio.
 * origem: _trg_ctrcs_unidade_cidade_por_filial (sistema atual)
 */
export function cidadeDaFilial(
  cte: { filial: string | null; unidadeCidade: string | null; unidadeUf: string | null },
  filiais: readonly FilialCadastrada[],
): { unidadeCidade: string | null; unidadeUf: string | null } {
  const chave = (s: string) => s.trim().toUpperCase();
  const sigla = chave(cte.filial ?? "");
  const filial =
    sigla === "" ? undefined : filiais.find((f) => f.cidade !== null && chave(f.sigla) === sigla);
  if (filial === undefined) return { unidadeCidade: cte.unidadeCidade, unidadeUf: cte.unidadeUf };
  return { unidadeCidade: filial.cidade, unidadeUf: filial.uf };
}

/**
 * Siglas das filiais próprias da empresa, ordenadas (vazio = []). Nas consultas vai como
 * parâmetro `$filiaisProprias::text[]` com `= ANY(...)`.
 * origem: filiais_proprias (sistema atual)
 */
export function filiaisProprias(filiais: readonly FilialCadastrada[]): string[] {
  return filiais
    .filter((f) => f.propria)
    .map((f) => f.sigla)
    .sort(ORDEM_DO_BANCO.compare);
}

/**
 * Unidade que responde pelo CT-e: destino, senão a atual, quando são filiais próprias; senão a
 * filial de emissão. origem: _unidade_responsavel (sistema atual)
 */
export function unidadeResponsavel(
  filiaisProprias: ReadonlySet<string>,
  c: { unidadeDestino: string | null; unidadeAtual: string | null; filial: string | null },
): string | null {
  if (c.unidadeDestino !== null && filiaisProprias.has(c.unidadeDestino)) return c.unidadeDestino;
  if (c.unidadeAtual !== null && filiaisProprias.has(c.unidadeAtual)) return c.unidadeAtual;
  return c.filial;
}

/**
 * CNPJs da própria empresa (só dígitos, distintos, não vazios): o da empresa e os emitentes
 * cadastrados na integração de XML de CT-e. A ingestão do 455 deixa o parceiro vazio quando o
 * expedidor é um deles.
 * origem: empresa_cnpjs_proprios (sistema atual)
 */
export function cnpjsPropriosDaEmpresa(
  cnpjDaEmpresa: string | null,
  cnpjsEmitentesXml: readonly string[],
): string[] {
  const todos = [cnpjDaEmpresa, ...cnpjsEmitentesXml].map(somenteDigitos).filter((d) => d !== "");
  return [...new Set(todos)];
}
