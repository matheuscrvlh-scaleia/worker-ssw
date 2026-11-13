/**
 * Contratos da tela Romaneio (todas as abas). As consultas com filtros em lista vão por POST com
 * corpo (a query string não carrega listas); nenhuma delas grava nada.
 * Spec: docs/regras/03-romaneio-prazo-parceiro.md.
 */
import { contrato } from "../contract";
import { dataIso, paginacao } from "../query";
import { z } from "../zod";

const textos = z.array(z.string().trim().min(1).max(200)).max(500);

export const CAMPOS_DATA = ["emissao", "embarque", "prevista", "saida", "conclusao"] as const;
export type CampoData = (typeof CAMPOS_DATA)[number];

/** Filtros da barra do topo, comuns a todas as abas menos Hoje (`fase2Filtros`). */
export const filtrosRomaneio = z
  .object({
    campo: z.enum(CAMPOS_DATA),
    inicio: dataIso,
    fim: dataIso,
    unidades: z.array(z.uuid()).max(200).optional(),
    /** CNPJ do pagador (rótulo "Parceiros" na tela), com ou sem máscara. */
    parceiros: textos.optional(),
    /** Unidade responsável (siglas). */
    filiais: textos.optional(),
    unidadeAtual: textos.optional(),
    remetente: z.string().max(500).optional(),
    destino: z.string().max(500).optional(),
    previsao: dataIso.optional(),
    codigos: z.array(z.number().int().min(0).max(99)).max(100).optional(),
    placas: textos.optional(),
    motoristas: textos.optional(),
    /** Só na aba Performance Ajudante. */
    ajudantes: textos.optional(),
    tipos: textos.optional(),
  })
  .refine((f) => f.inicio <= f.fim, {
    message: "O início do período é depois do fim.",
    path: ["fim"],
  });
export type FiltrosRomaneio = z.infer<typeof filtrosRomaneio>;

/** Documento digitado (só cards do topo e lista). */
const documento = {
  ctrc: z.string().trim().max(40).optional(),
  nf: z.string().trim().max(40).optional(),
};

export const RECORTES = [
  "todos",
  "entregues",
  "em_rota",
  "devolvido",
  "travado",
  "parado",
  "romaneados",
  "otif",
  "prejuizo",
  "em_rota_vencida",
  "em_rota_hoje",
  "em_rota_futuro",
  "em_rota_sem_prev",
  "tde_romaneado",
] as const;
export type Recorte = (typeof RECORTES)[number];

/** Filtro "Em rota agora" da lista. */
export const EM_ROTA_AGORA = ["todos", "sim", "nao"] as const;
export type EmRotaAgora = (typeof EM_ROTA_AGORA)[number];

export const AGRUPAMENTOS = ["none", "parceiro", "unidade", "cidade", "setor"] as const;
export type Agrupamento = (typeof AGRUPAMENTOS)[number];

/** Colunas que ordenam a lista (nomes da URL de hoje). Sem ordem: previsão crescente. */
export const ORDENS = [
  "numero_nf",
  "numero_ctrc",
  "data_emissao",
  "data_embarque",
  "parceiro",
  "unidade",
  "remetente",
  "cidade_destino",
  "peso",
  "volumes",
  "valor_frete",
  "status_atual",
] as const;
export type OrdemLista = (typeof ORDENS)[number];

export const TAMANHOS_DE_PAGINA = [25, 50, 100, 200] as const;
/** Com agrupamento a lista vem sem paginação, até este teto (Q04). */
export const LIMITE_AGRUPADO = 2000;
/** Teto da exportação da lista. */
export const LIMITE_EXPORTACAO = 10_000;

const filtrosDaLista = {
  ...documento,
  recorte: z.enum(RECORTES).default("todos"),
  emRotaAgora: z.enum(EM_ROTA_AGORA).default("todos"),
  status: z.enum(["todos", "andamento"]).default("todos"),
  busca: z.string().max(120).optional(),
  semMovimento: z.boolean().default(false),
};

export const entradaLista = z.object({
  filtros: filtrosRomaneio,
  ...filtrosDaLista,
  agrupar: z.enum(AGRUPAMENTOS).default("none"),
  ordem: z.enum(ORDENS).optional(),
  direcao: z.enum(["asc", "desc"]).default("asc"),
  ...paginacao({ opcoes: TAMANHOS_DE_PAGINA }),
});
export type EntradaLista = z.input<typeof entradaLista>;

const ultimaOcorrencia = z
  .object({
    codigo: z.number().int(),
    descricao: z.string().nullable(),
    dataHora: z.string().nullable(),
    fonte: z.enum(["bi2_0174", "bi2_0013", "webhook"]).nullable(),
  })
  .nullable();

export const linhaLista = z.object({
  id: z.uuid(),
  sigla: z.string(),
  numero: z.string(),
  numeroNf: z.number().nullable(),
  dataEmissao: z.string(),
  dataEmbarque: z.string().nullable(),
  dataPrevista: z.string().nullable(),
  dataEntregaRealizada: z.string().nullable(),
  parceiroId: z.string().nullable(),
  parceiroNome: z.string().nullable(),
  unidadeId: z.string().nullable(),
  filial: z.string().nullable(),
  unidadeCidade: z.string().nullable(),
  unidadeUf: z.string().nullable(),
  unidadeAtual: z.string().nullable(),
  placa: z.string().nullable(),
  motorista: z.string().nullable(),
  remetente: z.string().nullable(),
  destinatario: z.string().nullable(),
  cidadeDestino: z.string().nullable(),
  ufDestino: z.string().nullable(),
  setor: z.string().nullable(),
  bairro: z.string().nullable(),
  endereco: z.string().nullable(),
  valorMercadoria: z.number().nullable(),
  peso: z.number().nullable(),
  volumes: z.number().nullable(),
  valorFrete: z.number().nullable(),
  tde: z.number().nullable(),
  statusAtual: z.string().nullable(),
  ultimaOcorrencia,
  baixadoSemEntrega: z.boolean(),
  emRotaAgora: z.boolean(),
  atrasoDias: z.number().nullable(),
  performanceDias: z.number().nullable(),
  responsabilidadeCliente: z.boolean().nullable(),
});
export type LinhaLista = z.infer<typeof linhaLista>;

const somatorio = { ctes: z.number(), peso: z.number(), volumes: z.number(), frete: z.number() };

const limitesDeCarga = z.object({ pesoKg: z.number(), volumes: z.number() });

/** Linha exportada: a da lista + o que só o arquivo tem. */
export const linhaExportada = linhaLista.extend({
  pagador: z.string().nullable(),
  cep: z.string().nullable(),
  placaColeta: z.string().nullable(),
  placaEntrega: z.string().nullable(),
});
export type LinhaExportada = z.infer<typeof linhaExportada>;

const totaisDoTopo = z.object({
  ctes: z.number(),
  peso: z.number(),
  volumes: z.number(),
  frete: z.number(),
  emRota: z.number(),
  entregues: z.number(),
  baixadoSemEntrega: z.number(),
  travado: z.number(),
  travadoMotivo: z.string().nullable(),
  parado: z.number(),
  otifProblemas: z.number(),
  prejuizoCtes: z.number(),
  prejuizoFrete: z.number(),
  emRotaVencida: z.number(),
  emRotaHoje: z.number(),
  emRotaFuturo: z.number(),
  emRotaSemPrev: z.number(),
  tdeCtes: z.number(),
  tdeRomaneado: z.number(),
  tdeRomaneadoEmRota: z.number(),
  tdeRomaneadoEntregue: z.number(),
  tdeRomaneadoValor: z.number(),
});
export type TotaisDoTopo = z.infer<typeof totaisDoTopo>;

const faixas = z.object({
  vencida: z.number(),
  hoje: z.number(),
  futuro: z.number(),
  semPrev: z.number(),
});

export const FAIXAS_DO_DIA = ["vencida", "hoje", "futuro", "sem_prev", "todas"] as const;
export type FaixaDoDia = (typeof FAIXAS_DO_DIA)[number];

const filtrosDoDia = z.object({ filiais: textos.optional(), tipos: textos.optional() });

const linhaDoDia = z.object({
  romaneio: z.string(),
  dataRomaneio: z.string(),
  situacao: z.string().nullable(),
  placa: z.string().nullable(),
  motorista: z.string().nullable(),
  ajudante: z.string().nullable(),
  ajudante2: z.string().nullable(),
  ajudante3: z.string().nullable(),
  rota: z.string().nullable(),
  bairros: z.string().nullable(),
  ctes: z.number(),
  frete: z.number(),
  entregues: z.number(),
  naoEntregues: z.number(),
  performance: z.number().nullable(),
  fretePerdido: z.number(),
  prejudicadas: z.number(),
});
export type LinhaDoDia = z.infer<typeof linhaDoDia>;

export const cteDaFaixa = z.object({
  id: z.string().nullable(),
  sigla: z.string().nullable(),
  numero: z.string(),
  numeroNf: z.number().nullable(),
  romaneio: z.string().nullable(),
  destinatario: z.string().nullable(),
  pagador: z.string().nullable(),
  cidadeDestino: z.string().nullable(),
  ufDestino: z.string().nullable(),
  dataEmissao: z.string().nullable(),
  dataPrevista: z.string().nullable(),
  status: z.enum(["Entregue", "Finalizado sem entrega", "Em rota", "Sem conclusão"]),
  placa: z.string().nullable(),
});
export type CteDaFaixa = z.infer<typeof cteDaFaixa>;

const pessoa = z.object({
  nome: z.string(),
  placas: z.string().nullable(),
  equipe: z.string().nullable(),
  viagens: z.number(),
  romaneados: z.number(),
  entregues: z.number(),
  retornos: z.number(),
  prejudicadas: z.number(),
  prejudicadas13: z.number(),
  performance: z.number(),
});
export type LinhaPerformancePessoa = z.infer<typeof pessoa>;

const ponto = z.object({ ctes: z.number(), frete: z.number() });
const ranking = ponto.extend({ nome: z.string(), placa: z.string().nullable() });

export const comBusca = z.object({
  filtros: filtrosRomaneio,
  busca: z.string().max(60).optional(),
});

export const contratosRomaneio = {
  hoje: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/hoje",
    entrada: filtrosDoDia,
    saida: z.object({
      dia: z.string(),
      linhas: z.array(linhaDoDia),
      resumo: z.object({
        romaneios: z.number(),
        ctes: z.number(),
        entregues: z.number(),
        frete: z.number(),
        prejuizoFrete: z.number(),
        prejuizoCtes: z.number(),
        prazo: faixas,
        prazoNaoEntregue: faixas,
      }),
      tipos: z.array(z.string()),
    }),
  }),
  hojeCtes: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/hoje/ctes",
    entrada: filtrosDoDia.extend({
      faixa: z.enum(FAIXAS_DO_DIA),
      apenasNaoEntregues: z.boolean().default(false),
    }),
    saida: z.object({ total: z.number(), limite: z.number(), linhas: z.array(cteDaFaixa) }),
  }),
  totais: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/totais",
    entrada: z.object({
      filtros: filtrosRomaneio,
      ...documento,
      universo: z.enum(["todos", "romaneados"]),
      semMovimento: z.boolean().default(false),
    }),
    saida: z.object({ totais: totaisDoTopo, otifVisivel: z.boolean() }),
  }),
  lista: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/lista",
    entrada: entradaLista,
    saida: z.object({
      linhas: z.array(linhaLista),
      total: z.number(),
      totais: z.object({ ...somatorio, entregues: z.number() }),
      grupos: z.array(z.object({ chave: z.string(), rotulo: z.string(), ...somatorio })),
      limites: limitesDeCarga,
      hoje: z.string(),
    }),
  }),
  exportar: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/lista/exportar",
    entrada: z.object({
      filtros: filtrosRomaneio,
      ...filtrosDaLista,
      /** "somente": só os ids dados; "todas": todas menos os ids dados. */
      selecao: z.object({
        modo: z.enum(["todas", "somente"]),
        ids: z.array(z.uuid()).max(LIMITE_EXPORTACAO),
      }),
    }),
    saida: z.object({ linhas: z.array(linhaExportada), limites: limitesDeCarga, hoje: z.string() }),
  }),
  distribuicao: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/distribuicao",
    entrada: z.object({ filtros: filtrosRomaneio }),
    saida: z.array(
      z.object({
        codigo: z.number().nullable(),
        descricao: z.string().nullable(),
        pendencia: z.boolean(),
        qtd: z.number(),
      }),
    ),
  }),
  kpis: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/kpis",
    entrada: z.object({ filtros: filtrosRomaneio }),
    saida: z.object({
      total: z.number(),
      romaneado: z.number(),
      entregue: z.number(),
      naoEntregue: z.number(),
      prejudicada: z.number(),
      freteRomaneado: z.number(),
      fretePerdido: z.number(),
    }),
  }),
  ctesPorCarro: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/ctes-por-carro",
    entrada: z.object({ filtros: filtrosRomaneio }),
    saida: z.array(
      z.object({
        placa: z.string().nullable(),
        motorista: z.string().nullable(),
        ...somatorio,
      }),
    ),
  }),
  porViagem: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/por-viagem",
    entrada: comBusca,
    saida: z.array(
      z.object({
        romaneio: z.string(),
        dataRomaneio: z.string(),
        situacao: z.string().nullable(),
        placa: z.string().nullable(),
        motorista: z.string().nullable(),
        ajudante: z.string().nullable(),
        ajudante2: z.string().nullable(),
        ajudante3: z.string().nullable(),
        ctes: z.number(),
        frete: z.number(),
        entregues: z.number(),
        naoEntregues: z.number(),
        performance: z.number().nullable(),
        fretePerdido: z.number(),
        transferidas: z.number(),
      }),
    ),
  }),
  performanceMotoristas: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/performance/motoristas",
    entrada: z.object({ filtros: filtrosRomaneio }),
    saida: z.array(pessoa),
  }),
  performanceAjudantes: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/performance/ajudantes",
    entrada: z.object({ filtros: filtrosRomaneio }),
    saida: z.array(pessoa),
  }),
  performanceCarros: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/performance/carros",
    entrada: z.object({ filtros: filtrosRomaneio }),
    saida: z.array(
      z.object({
        motorista: z.string(),
        placa: z.string().nullable(),
        romaneados: z.number(),
        entregues: z.number(),
        prejudicadas: z.number(),
      }),
    ),
  }),
  prejuizo: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/prejuizo",
    entrada: z.object({ filtros: filtrosRomaneio }),
    saida: z.object({
      porDia: z.array(ponto.extend({ dia: z.string() })),
      porHora: z.array(ponto.extend({ hora: z.number() })),
      cidades: z.array(ranking),
      pagadores: z.array(ranking),
      motoristas: z.array(ranking),
    }),
  }),
  motivos: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/motivos-nao-entrega",
    entrada: z.object({
      filtros: filtrosRomaneio,
      limite: z.number().int().min(1).max(100).default(12),
    }),
    saida: z.array(z.object({ codigo: z.string(), descricao: z.string(), qtd: z.number() })),
  }),
  opcoes: contrato({
    metodo: "POST",
    caminho: "/api/v1/romaneio/opcoes",
    entrada: z.object({
      campo: z.enum(CAMPOS_DATA),
      inicio: dataIso,
      fim: dataIso,
      placas: textos.optional(),
      motoristas: textos.optional(),
    }),
    saida: z.object({
      placas: z.array(z.string()),
      motoristas: z.array(z.string()),
      pagadores: z.array(z.object({ cnpj: z.string(), nome: z.string() })),
      tipos: z.array(z.string()),
      filiais: z.array(z.object({ sigla: z.string(), nome: z.string() })),
      locaisAtuais: z.array(z.string()),
      codigos: z.array(z.object({ codigo: z.number(), descricao: z.string() })),
    }),
  }),
  linhaDoTempo: contrato({
    metodo: "GET",
    caminho: "/api/v1/romaneio/linha-do-tempo/:sigla/:numero",
    parametros: z.object({
      sigla: z.string().regex(/^[A-Z]{1,10}$/),
      numero: z.string().regex(/^[1-9][0-9]{0,14}$/),
    }),
    saida: z.array(
      z.object({
        dataHora: z.string(),
        codigo: z.string().nullable(),
        descricao: z.string().nullable(),
        complemento: z.string().nullable(),
        usuario: z.string().nullable(),
        unidade: z.string().nullable(),
        fonte: z.enum(["sistema", "ssw"]),
      }),
    ),
  }),
} as const;
