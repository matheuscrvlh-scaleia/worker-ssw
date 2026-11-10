import { ehTempoEsgotado } from "@erp/db";
import { ErroDeNegocio } from "@erp/dominio/erros";
import {
  type CodigoErro,
  type ErroPadrao,
  MENSAGEM_ERRO_INTERNO,
  MENSAGEM_TEMPO_ESGOTADO,
  STATUS_DO_CODIGO,
} from "@erp/shared/erros";
import { type FastifyError, type FastifyInstance, type FastifyReply } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

export function responder(reply: FastifyReply, codigo: CodigoErro, mensagem: string) {
  const corpo: ErroPadrao = { erro: { codigo, mensagem } };
  return reply.status(STATUS_DO_CODIGO[codigo]).send(corpo);
}

/** Primeiro problema, com o campo: "dados.limite: Grande demais: esperava…". */
function mensagemDeValidacao(validacao: readonly { instancePath: string; message?: string }[]) {
  const [primeiro] = validacao;
  if (!primeiro) return "Dados inválidos.";
  const campo = primeiro.instancePath.replace(/^\//, "").replaceAll("/", ".");
  const mensagem = primeiro.message ?? "valor inválido";
  return campo ? `${campo}: ${mensagem}` : mensagem;
}

export const muitasTentativas = () =>
  new ErroDeNegocio(
    "MUITAS_TENTATIVAS",
    "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  );

/**
 * Toda resposta de erro sai no formato padrão do ERP, sem detalhe interno (mesmo tratador de
 * erp-ssw/apps/api/src/http/tratador-erros.ts). As rotas públicas respondem os erros esperados no
 * formato delas; aqui chega o que escapou.
 */
export function registrarTratadorDeErros(app: FastifyInstance): void {
  app.setErrorHandler((erro: FastifyError, request, reply) => {
    if (erro instanceof ErroDeNegocio) return responder(reply, erro.codigo, erro.message);
    if (hasZodFastifySchemaValidationErrors(erro)) {
      return responder(reply, "ENTRADA_INVALIDA", mensagemDeValidacao(erro.validation));
    }
    if (ehTempoEsgotado(erro)) {
      request.log.warn({ err: erro }, "consulta cancelada por tempo");
      return responder(reply, "TEMPO_ESGOTADO", MENSAGEM_TEMPO_ESGOTADO);
    }
    if (erro.statusCode === 413) {
      return responder(reply, "ENTRADA_INVALIDA", "Conteúdo grande demais.");
    }
    if (erro.statusCode !== undefined && erro.statusCode >= 400 && erro.statusCode < 500) {
      return responder(reply, "ENTRADA_INVALIDA", "Requisição inválida.");
    }
    request.log.error({ err: erro }, "erro não tratado");
    return responder(reply, "ERRO_INTERNO", MENSAGEM_ERRO_INTERNO);
  });

  app.setNotFoundHandler((_request, reply) =>
    responder(reply, "NAO_ENCONTRADO", "Rota não encontrada."),
  );
}
