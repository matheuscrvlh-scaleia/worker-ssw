import { type CodigoErro } from "@erp/shared/erros";

/**
 * Erro esperado (regra violada, permissão, recurso inexistente). A mensagem vai como está para o
 * operador, então precisa dizer o que fazer. Qualquer outro erro vira "erro interno" sem detalhe.
 */
export class ErroDeNegocio extends Error {
  readonly codigo: CodigoErro;

  constructor(codigo: CodigoErro, mensagem: string) {
    super(mensagem);
    this.name = "ErroDeNegocio";
    this.codigo = codigo;
  }
}
