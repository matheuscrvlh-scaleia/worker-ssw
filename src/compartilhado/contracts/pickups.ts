import { contrato } from "../contract";
import { dataIso, paginacao } from "../query";
import { z } from "../zod";

export const ETAPAS_DE_COLETA = ["cadastrada", "comandada", "coletada", "cancelada"] as const;
export type EtapaDeColeta = (typeof ETAPAS_DE_COLETA)[number];

export const STATUS_DE_PRAZO = [
  "no_prazo",
  "atrasada",
  "cancelada",
  "vencida",
  "vence_hoje",
  "a_vencer",
] as const;
export type StatusDePrazo = (typeof STATUS_DE_PRAZO)[number];

/** Cards da tela (filtro `status` da URL e da lista). */
export const STATUS_DA_LISTA = [
  "todas",
  "coletadas",
  "no_prazo",
  "atrasadas",
  "abertas",
  "cadastradas",
  "comandadas",
  "vencidas",
  "vence_hoje",
  "a_vencer",
  "canceladas",
  "com_ctrc",
  "prejudicadas",
] as const;
export type StatusDaLista = (typeof STATUS_DA_LISTA)[number];

export const TIPOS_DE_COLETA = ["NORMAL", "REVERSA"] as const;

export const filtrosDeColetas = z.object({
  inicio: dataIso,
  fim: dataIso,
  unidades: z.array(z.string().trim().max(10)).max(50).default([]),
  solicitantes: z.array(z.string().max(100)).max(200).default([]),
  tipo: z.enum(TIPOS_DE_COLETA).nullable().default(null),
});
export type FiltrosDeColetas = z.infer<typeof filtrosDeColetas>;

const totais = z.object({
  total: z.number().int(),
  coletadas: z.number().int(),
  noPrazo: z.number().int(),
  atrasadas: z.number().int(),
  canceladas: z.number().int(),
  abertas: z.number().int(),
  cadastradas: z.number().int(),
  comandadas: z.number().int(),
  vencidas: z.number().int(),
  venceHoje: z.number().int(),
  aVencer: z.number().int(),
  comCtrc: z.number().int(),
  prejudicadas: z.number().int(),
  reversas: z.number().int(),
});
export type TotaisDeColetas = z.infer<typeof totais>;

export const painelDeColetas = z.object({
  totais,
  porSolicitante: z.array(
    z.object({
      solicitante: z.string(),
      total: z.number().int(),
      coletadas: z.number().int(),
      noPrazo: z.number().int(),
      atrasadas: z.number().int(),
      abertas: z.number().int(),
    }),
  ),
  porUnidade: z.array(
    z.object({
      unidade: z.string(),
      total: z.number().int(),
      coletadas: z.number().int(),
      noPrazo: z.number().int(),
      atrasadas: z.number().int(),
      abertas: z.number().int(),
      vencidas: z.number().int(),
      canceladas: z.number().int(),
    }),
  ),
  porDia: z.array(
    z.object({
      dia: z.string(),
      total: z.number().int(),
      noPrazo: z.number().int(),
      atrasadas: z.number().int(),
    }),
  ),
  porTipoCtrc: z.array(
    z.object({ tipoDocumento: z.string(), coletas: z.number().int(), ctes: z.number().int() }),
  ),
  opcoes: z.object({ unidades: z.array(z.string()), solicitantes: z.array(z.string()) }),
  /** Emissão do 050 mais recente gravado (selo de sincronização); nulo sem importação. */
  posicaoEm: z.string().nullable(),
  cobertura: z.object({ inicio: z.string().nullable(), fim: z.string().nullable() }),
});
export type PainelDeColetas = z.infer<typeof painelDeColetas>;

export const linhaDeColeta = z.object({
  unidade: z.string(),
  numero: z.number().int(),
  tipo: z.string(),
  etapa: z.enum(ETAPAS_DE_COLETA),
  statusPrazo: z.enum(STATUS_DE_PRAZO),
  cadastradaEm: z.string().nullable(),
  limiteEm: z.string().nullable(),
  coletadaEm: z.string().nullable(),
  canceladaEm: z.string().nullable(),
  solicitante: z.string().nullable(),
  remetenteCnpj: z.string().nullable(),
  remetenteNome: z.string().nullable(),
  remetenteCidade: z.string().nullable(),
  destinatarioNome: z.string().nullable(),
  destinoCidade: z.string().nullable(),
  motorista: z.string().nullable(),
  placa: z.string().nullable(),
  volumes: z.number().int().nullable(),
  pesoKg: z.number().nullable(),
  valorMercadoria: z.number().nullable(),
  tipoFrete: z.string().nullable(),
  notasFiscais: z.string().nullable(),
  cteSigla: z.string().nullable(),
  cteNumero: z.string().nullable(),
  cteTipoDocumento: z.string().nullable(),
  cteEmissao: z.string().nullable(),
  prejudicadaHorario: z.boolean(),
  ultimoEvento: z.string().nullable(),
});
export type LinhaDeColeta = z.infer<typeof linhaDeColeta>;

export const eventoDeColeta = z.object({
  em: z.string().nullable(),
  unidade: z.string(),
  usuario: z.string(),
  texto: z.string(),
});

const resumoDoSsw = z.object({
  quantidade: z.number().int(),
  cadastradas: z.number().int(),
  comandadas: z.number().int(),
  coletadas: z.number().int(),
  canceladas: z.number().int(),
  noPrazo: z.number().int(),
  atrasadas: z.number().int(),
});

const periodo = z.object({ inicio: z.string(), fim: z.string() }).nullable();

export const resultadoDaImportacao050 = z.object({
  emitidoEm: z.string(),
  periodoCadastro: periodo,
  periodoColeta: periodo,
  unidades: z.array(z.string()),
  lidas: z.number().int(),
  gravadas: z.number().int(),
  /** Sem unidade/número, repetidas no arquivo ou já gravadas a partir de um 050 mais novo. */
  ignoradas: z.number().int(),
  resumoSsw: resumoDoSsw.nullable(),
  avisos: z.array(z.object({ linha: z.number().int(), motivo: z.string() })),
});
export type ResultadoDaImportacao050 = z.infer<typeof resultadoDaImportacao050>;

/** Teto do arquivo enviado (caracteres, já decodificado em ISO-8859-1 no navegador). */
export const TAMANHO_MAXIMO_DO_050 = 30_000_000;

const filtrosDaLista = filtrosDeColetas.extend({
  status: z.enum(STATUS_DA_LISTA).default("todas"),
  busca: z.string().max(100).default(""),
});

export const contratosColetas = {
  painel: contrato({
    metodo: "POST",
    caminho: "/api/v1/coletas/painel",
    entrada: filtrosDeColetas,
    saida: painelDeColetas,
  }),
  lista: contrato({
    metodo: "POST",
    caminho: "/api/v1/coletas/lista",
    entrada: filtrosDaLista.extend({
      ...paginacao({ maximo: 1000 }),
    }),
    saida: z.object({ linhas: z.array(linhaDeColeta), total: z.number().int() }),
  }),
  /** A lista inteira de um card numa leitura só, na ordem da tela (até 100 mil coletas). */
  exportar: contrato({
    metodo: "POST",
    caminho: "/api/v1/coletas/lista/exportacao",
    entrada: filtrosDaLista,
    saida: z.object({ linhas: z.array(linhaDeColeta) }),
  }),
  detalhe: contrato({
    metodo: "GET",
    caminho: "/api/v1/coletas/:unidade/:numero",
    parametros: z.object({
      unidade: z.string().trim().min(1).max(10),
      numero: z.coerce.number().int().min(1),
    }),
    saida: z.object({
      observacao: z.string().nullable(),
      mercadoria: z.string().nullable(),
      setor: z.string().nullable(),
      romaneio: z.string().nullable(),
      cadastradaPor: z.string().nullable(),
      comandadaEm: z.string().nullable(),
      limiteInicial: z.string().nullable(),
      relatorioEmitidoEm: z.string(),
      historico: z.array(eventoDeColeta),
    }),
  }),
  importar050: contrato({
    metodo: "POST",
    caminho: "/api/v1/coletas/importacoes-050",
    entrada: z.object({
      conteudo: z.string().min(1).max(TAMANHO_MAXIMO_DO_050),
      arquivoOrigem: z.string().trim().min(1).max(300),
    }),
    saida: resultadoDaImportacao050,
  }),
} as const;
