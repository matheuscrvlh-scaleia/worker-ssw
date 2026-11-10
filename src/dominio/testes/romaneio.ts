/** Montadores de dados para os testes do Romaneio (não entram no código de produção). */
import { type Linha036 } from "../romaneio/hoje";
import {
  type Cadastro,
  type CodigoCadastrado,
  criarCadastro,
  type FatoCte,
  type OcorrenciaDoCte,
} from "../romaneio/situacao";
import { type Viagem } from "../romaneio/viagens";

const codigo = (
  c: number,
  descricao: string,
  extra: Partial<CodigoCadastrado> = {},
): CodigoCadastrado => ({
  codigo: c,
  descricao,
  tipoSsw: null,
  penaliza: false,
  responsavel: "sistema",
  ...extra,
});

/** Catálogo parecido com o da FR. */
export const CADASTRO_FR: Cadastro = criarCadastro([
  codigo(1, "ENTREGA REALIZADA", { tipoSsw: "ENTREGA" }),
  codigo(9, "DESTINATARIO AUSENTE", { tipoSsw: "PENDENCIA_CLIENTE", responsavel: "destinatario" }),
  codigo(12, "DEVOLUCAO", { tipoSsw: "BAIXA" }),
  codigo(13, "RETORNO", { tipoSsw: "PENDENCIA_TRANSPORTADORA", penaliza: true, responsavel: "FR" }),
  codigo(85, "SAIDA PARA ENTREGA", { tipoSsw: "INFORMATIVA" }),
  codigo(99, "CANCELADO", { tipoSsw: "BAIXA" }),
]);

export function ocorrencia(
  c: number,
  quando: string,
  extra: Partial<OcorrenciaDoCte> = {},
): OcorrenciaDoCte {
  const dataHora = new Date(quando);
  return { codigo: c, dataHora, quarentena: false, criadoEm: dataHora, ...extra };
}

let sequencia = 0;

export function fato(extra: Partial<FatoCte> = {}): FatoCte {
  sequencia += 1;
  return {
    id: `cte-${sequencia}`,
    sigla: "CAP",
    numero: String(1000 + sequencia),
    dataEmissao: "2026-10-26",
    dataPrevista: null,
    dataEntregaRealizada: null,
    criadoEm: new Date("2026-10-26T10:00:00Z"),
    ocorrEfetivaCodigo: null,
    codigo0013: null,
    codigo0174: null,
    valorFrete: 100,
    peso: 10,
    volumes: 1,
    tde: null,
    cidadeDestino: "CAMPINAS",
    pagadorNome: "GRENDENE",
    ocorrencias: [],
    ...extra,
  };
}

export function viagem(extra: Partial<Viagem> & { romaneio: string; dataSaida: string }): Viagem {
  return {
    situacao: "BAIXADO",
    placa: "KQK6I98",
    motorista: "JOAO DA SILVA",
    motoristaNormalizado: "JOAO DA SILVA",
    ajudante: null,
    ajudante2: null,
    ajudante3: null,
    primeira: true,
    ultima: true,
    proximaSaida: null,
    ...extra,
  };
}

export function linha036(extra: Partial<Linha036> = {}): Linha036 {
  return {
    romaneio: "R1",
    ctrc: "CAP038984-6",
    situacao: "BAIXADO",
    placa: "kqk-6i98",
    motorista: "JOAO",
    ajudante: null,
    ajudante2: null,
    ajudante3: null,
    conferente: null,
    dataEmissao: "2026-11-10",
    horaEmissao: "08:00",
    cidadeEntrega: "CAMPINAS / SP",
    bairro: "CENTRO",
    codOcorrCtrc: null,
    descOcorrCtrc: null,
    dataOcorrCtrc: null,
    horaOcorrCtrc: null,
    importadoEm: new Date("2026-11-10T12:00:00Z"),
    ...extra,
  };
}
