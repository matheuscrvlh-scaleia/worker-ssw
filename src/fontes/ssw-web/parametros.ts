/**
 * Credencial e opções do SSW web da empresa (`empresa_integracoes` tipo `ssw_web`, ADR 0013 do
 * ERP). O cadastro é só no ERP; aqui só se lê. A senha é o segredo cifrado da integração.
 */
import { type IntegracaoGravada, parametroTexto } from "../comum/integracao";

export interface ConfiguracaoSswWeb {
  dominio: string;
  cpf: string;
  usuario: string;
  senha: string;
  /** Unidade que abre as opções da matriz (036, 306, 455, 930, 156, 050). */
  matriz: string;
  /** 038 por unidade, enviado mesmo vazio. */
  unidades038: string[];
  /** 038 por unidade, descartado quando volta sem dado (unidade que ainda não opera). */
  unidades038SoComDados: string[];
  /** 050 (coletas) por filial; vazio = sem 050. */
  unidades050: string[];
}

export type LeituraDaConfiguracao =
  { ok: true; config: ConfiguracaoSswWeb } | { ok: false; mensagem: string };

const SIGLA = /^[A-Z0-9]{2,4}$/;

/** Lista como a tela grava (array ou texto separado por vírgula), em maiúsculas e sem repetir. */
export function siglasDaLista(valor: unknown): string[] {
  const itens = Array.isArray(valor) ? valor : typeof valor === "string" ? valor.split(",") : [];
  const siglas = itens
    .filter((i): i is string => typeof i === "string")
    .map((i) => i.trim().toUpperCase())
    .filter((i) => i !== "");
  return [...new Set(siglas)];
}

export function configuracaoSswWeb(
  integracao: IntegracaoGravada | null,
  senha: string | null,
): LeituraDaConfiguracao {
  if (!integracao?.ativo) {
    return { ok: false, mensagem: "A integração SSW web está desligada para esta empresa." };
  }
  const p = integracao.parametros;
  const dominio = (parametroTexto(p, "dominio") || (integracao.dominioSswDaEmpresa ?? ""))
    .trim()
    .toUpperCase();
  const cpf = parametroTexto(p, "cpf").replace(/\D/g, "");
  const usuario = parametroTexto(p, "usuario");
  const matriz = (parametroTexto(p, "unidade_matriz") || "MTZ").toUpperCase();
  const unidades038 = siglasDaLista(p.unidades_038);
  const unidades038SoComDados = siglasDaLista(p.unidades_038_so_com_dados).filter(
    (u) => !unidades038.includes(u),
  );
  const unidades050 = siglasDaLista(p.unidades_050);

  const faltando = [
    dominio === "" ? "domínio" : null,
    cpf.length !== 11 ? "CPF (11 dígitos)" : null,
    usuario === "" ? "usuário" : null,
    senha === null ? "senha" : null,
  ].filter((f) => f !== null);
  if (faltando.length > 0 || senha === null) {
    return { ok: false, mensagem: `Integração SSW web incompleta: falta ${faltando.join(", ")}.` };
  }
  const invalidas = [matriz, ...unidades038, ...unidades038SoComDados, ...unidades050].filter(
    (u) => !SIGLA.test(u),
  );
  if (invalidas.length > 0) {
    return {
      ok: false,
      mensagem: `Integração SSW web com unidade inválida: ${invalidas.join(", ")}.`,
    };
  }
  return {
    ok: true,
    config: {
      dominio,
      cpf,
      usuario,
      senha,
      matriz,
      unidades038,
      unidades038SoComDados,
      unidades050,
    },
  };
}
