/**
 * Partes do CT-e pelo 455 (remetente, destinatário, parceiro = expedidor, TDE, setor, chave,
 * placa de coleta, unidade de origem, comprovante), no fim de cada ciclo aplicado. Spec 06 §3.6.2.
 */
import { formatarCnpjCpf, somenteDigitos } from "@erp/dominio/nucleo";

import { numero455, type Registro455Csv, texto455 } from "../../fontes/relatorios";
import { semCodigo, uniaoOrdenada } from "./candidato";
import {
  aparado,
  type CamposDoCte,
  type CteDaIngestao,
  instanteSp,
  type LinhaGuardada,
  maisNovaPrimeiro,
  maiusculoAparado,
  numericIgual,
  paraNumeric,
} from "./comum";

/** Janela do 455 lida a cada ciclo. */
export const JANELA_PARTES_455_MS = 2 * 24 * 3_600_000;

export interface PartesDo455 {
  /** Chave de 44 dígitos que o CT-e receberia (o caso de uso confere se está livre). */
  chave: string | null;
  campos: CamposDoCte;
  /** Contadores do que mudou (para o total do ciclo). */
  mudou: {
    remetente: boolean;
    destinatario: boolean;
    parceiro: boolean;
    tde: boolean;
    setor: boolean;
    placaColeta: boolean;
    unidadeOrigem: boolean;
    comprovante: boolean;
  };
}

/**
 * O que o 455 muda no CT-e. `linhas` = linhas do 455 CSV do CT-e na janela; `proprios` = CNPJs
 * (dígitos) da empresa: expedidor da própria empresa ou igual ao remetente não é parceiro.
 * origem: aplicar_partes_455 (sistema atual)
 */
export function partesDo455(
  p: CteDaIngestao,
  linhas: readonly LinhaGuardada<Registro455Csv>[],
  proprios: ReadonlySet<string>,
): PartesDo455 | null {
  const ordenadas = [...linhas].sort(maisNovaPrimeiro);
  const s = ordenadas[0]?.dados;
  if (!s) return null;
  const cnpjRemetente = formatarCnpjCpf(texto455(s, "cnpj_remetente"));
  const cnpjDestinatario = formatarCnpjCpf(texto455(s, "cnpj_destinatario"));
  const cnpjExpedidor = formatarCnpjCpf(texto455(s, "cnpj_expedidor"));
  const parceiroCnpj =
    cnpjExpedidor !== null &&
    cnpjExpedidor !== cnpjRemetente &&
    !proprios.has(somenteDigitos(cnpjExpedidor))
      ? cnpjExpedidor
      : null;
  const parceiroNome = parceiroCnpj ? semCodigo(texto455(s, "cliente_expedidor")) : null;
  const tde = numero455(s, "tde");
  const setor = (texto455(s, "setor_de_destino") ?? "").trim().split(" ")[0] || null;
  const chaveBruta = (texto455(s, "chave_ct_e") ?? "").trim();
  const chave = /^\d{44}$/.test(chaveBruta) ? chaveBruta : null;
  const placaColeta = maiusculoAparado(texto455(s, "placa_de_coleta"));
  const unidadeOrigem = maiusculoAparado(texto455(s, "unidade_emissora"));

  const campos: CamposDoCte = {};
  const marcas: string[] = [];
  if (cnpjRemetente !== null) {
    if (p.cnpjRemetente !== cnpjRemetente) campos.cnpjRemetente = cnpjRemetente;
    marcas.push("cnpj_remetente");
  }
  if (cnpjDestinatario !== null) {
    if (p.cnpjDestinatario !== cnpjDestinatario) campos.cnpjDestinatario = cnpjDestinatario;
    marcas.push("cnpj_destinatario");
  }
  if (cnpjExpedidor !== null) {
    // Pode zerar o parceiro anterior (expedidor passou a ser o remetente ou a própria empresa).
    if (p.parceiroCnpj !== parceiroCnpj) campos.parceiroCnpj = parceiroCnpj;
    if (p.parceiroNome !== parceiroNome) campos.parceiroNome = parceiroNome;
    marcas.push("parceiro_cnpj", "parceiro_nome");
  }
  if (tde !== null && !numericIgual(p.tde, tde, 2)) campos.tde = paraNumeric(tde, 2);
  if (p.setor === null && setor !== null) campos.setor = setor;
  if (placaColeta !== null) {
    if (p.placaColeta !== placaColeta) campos.placaColeta = placaColeta;
    marcas.push("placa_coleta");
  }
  if (unidadeOrigem !== null) {
    if (p.unidadeOrigem !== unidadeOrigem) campos.unidadeOrigem = unidadeOrigem;
    marcas.push("unidade_origem");
  }

  const comprovante = comprovanteDo455(ordenadas);
  const comprovanteMudou =
    comprovante !== null &&
    (p.comprovanteEscaneado !== comprovante.escaneado ||
      p.comprovanteEscaneadoEm?.getTime() !== comprovante.em?.getTime());
  if (comprovante !== null && comprovanteMudou) {
    campos.comprovanteEscaneado = comprovante.escaneado;
    campos.comprovanteEscaneadoEm = comprovante.em;
  }

  const novasMarcas = uniaoOrdenada(p.camposSsw, marcas);
  if (novasMarcas.length !== p.camposSsw.length) campos.camposSsw = novasMarcas;
  return {
    chave: p.chave === null ? chave : null,
    campos,
    mudou: {
      remetente: "cnpjRemetente" in campos,
      destinatario: "cnpjDestinatario" in campos,
      parceiro: "parceiroCnpj" in campos || "parceiroNome" in campos,
      tde: "tde" in campos,
      setor: "setor" in campos,
      placaColeta: "placaColeta" in campos,
      unidadeOrigem: "unidadeOrigem" in campos,
      comprovante: comprovanteMudou,
    },
  };
}

/** Última linha com "Compr. de Entrega Escaneado" preenchido: S = escaneado, com data e hora. */
function comprovanteDo455(
  ordenadas: readonly LinhaGuardada<Registro455Csv>[],
): { escaneado: boolean; em: Date | null } | null {
  const linha = ordenadas.find((l) => aparado(texto455(l.dados, "compr_de_entrega_escaneado")));
  if (!linha) return null;
  const flag = aparado(texto455(linha.dados, "compr_de_entrega_escaneado")) ?? "";
  const data = texto455(linha.dados, "data_do_escaneamento");
  const hora = /^(\d{2}:\d{2})/.exec(
    (texto455(linha.dados, "hora_do_escaneamento") ?? "").trim(),
  )?.[1];
  return {
    escaneado: flag.charAt(0).toUpperCase() === "S",
    em: data ? instanteSp(`${data}T${hora ?? "00:00"}`) : null,
  };
}

/**
 * Filial e unidade de destino pelo 455 (job de :08 e :38, últimas 48 h): troca a filial quando a
 * atual é nula ou não é filial própria; a unidade de destino só é preenchida se vazia.
 * origem: ctrcs_unidade_pelo_455 (sistema atual)
 */
export function unidadePelo455(
  p: Pick<CteDaIngestao, "filial" | "unidadeDestino">,
  ultima: Registro455Csv,
  filiaisProprias: ReadonlySet<string>,
): CamposDoCte {
  const filial = maiusculoAparado(texto455(ultima, "unidade_emissora"));
  if (filial === null || filial === p.filial) return {};
  if (p.filial !== null && filiaisProprias.has(p.filial)) return {};
  return {
    filial,
    unidadeDestino: p.unidadeDestino ?? maiusculoAparado(texto455(ultima, "unidade_receptora")),
  };
}
