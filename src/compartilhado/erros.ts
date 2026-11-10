import { z } from "./zod";

/** Códigos estáveis do erro padrão. A mensagem é para o operador; o código é para o código. */
const CODIGOS_ERRO = [
  "NAO_AUTENTICADO",
  "SESSAO_EXPIRADA",
  "SEM_EMPRESA",
  "SEM_PERMISSAO",
  "MODULO_NAO_LIBERADO",
  "ENTRADA_INVALIDA",
  "NAO_ENCONTRADO",
  "CONFLITO",
  "MUITAS_TENTATIVAS",
  "TEMPO_ESGOTADO",
  "INDISPONIVEL",
  "ERRO_INTERNO",
] as const;

export type CodigoErro = (typeof CODIGOS_ERRO)[number];

export const erroPadrao = z.object({
  erro: z.object({
    codigo: z.enum(CODIGOS_ERRO),
    mensagem: z.string(),
  }),
});

export type ErroPadrao = z.infer<typeof erroPadrao>;

export const STATUS_DO_CODIGO: Record<CodigoErro, number> = {
  NAO_AUTENTICADO: 401,
  SESSAO_EXPIRADA: 401,
  SEM_EMPRESA: 403,
  SEM_PERMISSAO: 403,
  MODULO_NAO_LIBERADO: 403,
  ENTRADA_INVALIDA: 422,
  NAO_ENCONTRADO: 404,
  CONFLITO: 409,
  MUITAS_TENTATIVAS: 429,
  TEMPO_ESGOTADO: 503,
  INDISPONIVEL: 503,
  ERRO_INTERNO: 500,
};

export const MENSAGEM_TEMPO_ESGOTADO =
  "A consulta demorou demais. Reduza o período ou aplique mais filtros (unidade, parceiro, filial) e tente novamente.";

export const MENSAGEM_ERRO_INTERNO =
  "Não foi possível concluir agora. Tente de novo em instantes; se continuar, fale com o suporte.";

export const MENSAGEM_RECARREGAR = "O sistema foi atualizado. Recarregue a página (F5).";
