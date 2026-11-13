/**
 * Erro pronto para o log, sem o SQL e sem os parâmetros. O `DrizzleQueryError` leva a consulta e
 * os valores (e-mail, CNPJ, hash…) na mensagem, no `stack` e nos campos `query`/`params`; o erro
 * do pg leva valores em `detail`/`where`. Fica o tipo, o código do Postgres, a restrição e o
 * caminho do código.
 */
const CAMPOS_DO_PG = ["code", "severity", "constraint", "table", "column", "routine"] as const;
const PROFUNDIDADE_MAXIMA = 3;

export interface ErroDoLog {
  type: string;
  message: string;
  stack: string;
  [campo: string]: unknown;
}

export function erroParaLog(erro: unknown, profundidade = 0): ErroDoLog {
  if (typeof erro !== "object" || erro === null) {
    return { type: typeof erro, message: String(erro), stack: "" };
  }
  const temConsulta = "query" in erro || "params" in erro;
  const mensagem = "message" in erro && typeof erro.message === "string" ? erro.message : "";
  // A 1ª linha do stack repete a mensagem (com o SQL): ficam só as linhas "at ...".
  const pilha = "stack" in erro && typeof erro.stack === "string" ? erro.stack : "";
  const saida: ErroDoLog = {
    type: erro instanceof Error ? erro.constructor.name : "Object",
    message: temConsulta ? "Falha na consulta ao banco (SQL e parâmetros omitidos)." : mensagem,
    stack: pilha
      .split("\n")
      .filter((l) => l.trimStart().startsWith("at "))
      .join("\n"),
  };
  for (const campo of CAMPOS_DO_PG) {
    const valor: unknown = Reflect.get(erro, campo);
    if (typeof valor === "string" || typeof valor === "number") saida[campo] = valor;
  }
  if ("statusCode" in erro && typeof erro.statusCode === "number") {
    saida.statusCode = erro.statusCode;
  }
  if ("cause" in erro && erro.cause !== undefined && profundidade < PROFUNDIDADE_MAXIMA) {
    saida.cause = erroParaLog(erro.cause, profundidade + 1);
  }
  return saida;
}
