/**
 * Catálogos da Plataforma usados pela API (validação) e pela tela (rótulos): status de empresa,
 * integrações e o que cada uma guarda.
 * origem: src/features/plataforma/types.ts (sistema atual)
 */
export const STATUS_EMPRESA = ["implantacao", "ativa", "suspensa", "encerrada"] as const;
export type StatusEmpresa = (typeof STATUS_EMPRESA)[number];

export const ROTULO_DO_STATUS: Record<StatusEmpresa, string> = {
  implantacao: "Em implantação",
  ativa: "Ativa",
  suspensa: "Suspensa",
  encerrada: "Encerrada",
};

export const TIPOS_INTEGRACAO = [
  "sftp",
  "ssw_api",
  "ssw_bi2",
  "ssw_webhook",
  "ahgora",
  "xml_cte",
  "ingestao_publica",
] as const;
export type TipoIntegracao = (typeof TIPOS_INTEGRACAO)[number];

/**
 * Se a integração está funcionando: desligada; ativa (conectou ou trouxe dado nas últimas 24 h);
 * com falha (a última conexão falhou); sem sinal (ligada, mas nada recente).
 */
export const SITUACOES_DA_INTEGRACAO = ["desligada", "ativa", "com_falha", "sem_sinal"] as const;
export type SituacaoDaIntegracao = (typeof SITUACOES_DA_INTEGRACAO)[number];

export const ROTULO_DA_SITUACAO_DA_INTEGRACAO: Record<SituacaoDaIntegracao, string> = {
  desligada: "Desligada",
  ativa: "Ativa",
  com_falha: "Com falha",
  sem_sinal: "Sem sinal",
};

interface InfoDaIntegracao {
  nome: string;
  descricao: string;
  campos: readonly { chave: string; rotulo: string; lista?: boolean; dica?: string }[];
  /** Rótulo do segredo (senha/token); sem ele a integração não tem segredo próprio. */
  segredo?: string;
  /** Tela que opera essa integração. */
  tela?: string;
  /** Rótulo do último dado que ela traz (sem ele, a integração só conecta). */
  ultimoDado?: string;
  /** Nada registra a atividade dela: a tela não mostra situação, conexão nem dado. */
  semMonitoramento?: true;
}

export const INFO_DA_INTEGRACAO: Record<TipoIntegracao, InfoDaIntegracao> = {
  sftp: {
    nome: "SFTP (relatórios do SSW)",
    descricao: "Pasta de onde o sistema puxa os CSV 038, 455, 930, 306, 036 e 050.",
    campos: [
      { chave: "host", rotulo: "Servidor" },
      { chave: "porta", rotulo: "Porta" },
      { chave: "usuario", rotulo: "Usuário" },
      {
        chave: "impressao_digital",
        rotulo: "Impressão digital do servidor",
        dica: "Obrigatória: sem ela o sistema não conecta. Peça ao provedor ou rode “ssh-keyscan -p <porta> <servidor> | ssh-keygen -lf -” e copie o SHA256:… da linha da chave.",
      },
      { chave: "caminho_xml", rotulo: "Pasta dos XML", dica: "Ex.: /xml_ssw" },
      { chave: "relatorios_path", rotulo: "Pasta dos relatórios" },
      { chave: "importados_path", rotulo: "Pasta dos importados" },
    ],
    segredo: "Senha do SFTP",
    tela: "/admin/ingestao",
    ultimoDado: "Último arquivo recebido",
  },
  ssw_api: {
    nome: "SSW API",
    descricao: "Consulta de rastreamento e ocorrências na API do SSW.",
    campos: [
      { chave: "dominio", rotulo: "Domínio" },
      { chave: "usuario", rotulo: "Usuário" },
      { chave: "cnpj_edi", rotulo: "CNPJ EDI" },
      {
        chave: "url",
        rotulo: "Endereço da API",
        dica: "Vazio = https://ssw.inf.br/api. Para usar outro servidor (ex.: o provisório tms.ssw.inf.br), digite o endereço; sem caminho, o sistema completa com /api.",
      },
    ],
    segredo: "Senha da SSW API",
    tela: "/admin/ssw-diagnostico",
    ultimoDado: "Último token gerado",
  },
  ssw_bi2: {
    nome: "SSW BI2",
    descricao: "API CSV do BI2 (CT-e, 0013, 0017, 0174, 0220).",
    campos: [{ chave: "dominio", rotulo: "Domínio", dica: "Ex.: FRT" }],
    segredo: "Token do BI2",
    tela: "/admin/ingestao",
    ultimoDado: "Última sincronização",
  },
  ssw_webhook: {
    nome: "Webhook SSW",
    descricao: "Ocorrências enviadas pelo SSW em tempo real.",
    campos: [
      { chave: "cnpjs_aceitos", rotulo: "CNPJs aceitos", lista: true, dica: "Separe por vírgula" },
    ],
    segredo: "Segredo do webhook",
    tela: "/admin/ingestao",
    ultimoDado: "Última ocorrência recebida",
  },
  ahgora: {
    nome: "Ahgora (ponto)",
    descricao: "Batidas de ponto para apuração e bonificação.",
    campos: [{ chave: "usuario", rotulo: "Usuário da API" }],
    segredo: "Senha da API",
    tela: "/admin/ahgora",
  },
  xml_cte: {
    nome: "XML CT-e",
    descricao: "XML dos CT-e emitidos, puxados do SFTP.",
    campos: [
      {
        chave: "cnpjs_emitentes",
        rotulo: "CNPJs emitentes",
        lista: true,
        dica: "Separe por vírgula",
      },
    ],
    tela: "/admin/xml-cte",
    ultimoDado: "Último XML importado",
  },
  ingestao_publica: {
    nome: "Rotas públicas da ingestão",
    descricao:
      "Segredo que quem chama /api/public/ftp-relatorio-import, ssw-ciclo-aplicar e xml-orfaos-retry manda no cabeçalho x-ftp-ingest-secret (ou x-cron-token). Identifica a empresa.",
    campos: [],
    segredo: "Segredo das rotas públicas",
    semMonitoramento: true,
  },
};

/**
 * Integrações da própria Plataforma (valem para todas as empresas): o que antes ficava no .env da
 * VPS. O segredo de cada uma vai cifrado com a chave mestra (`SEGREDOS_CHAVES`), que fica no .env.
 */
export const TIPOS_INTEGRACAO_PLATAFORMA = ["dominio", "email", "worker_ssw"] as const;
export type TipoIntegracaoPlataforma = (typeof TIPOS_INTEGRACAO_PLATAFORMA)[number];

export const INFO_DA_INTEGRACAO_PLATAFORMA: Record<TipoIntegracaoPlataforma, InfoDaIntegracao> = {
  dominio: {
    nome: "Domínio do sistema",
    descricao: "Endereço público do ERP: monta os links do convite e do “esqueci minha senha”.",
    campos: [{ chave: "url", rotulo: "Endereço", dica: "Ex.: https://erp.suaempresa.com.br" }],
  },
  email: {
    nome: "E-mail (Resend)",
    descricao: "Envio do convite e do “esqueci minha senha” pelo Resend.",
    campos: [
      {
        chave: "remetente",
        rotulo: "Remetente",
        dica: "Ex.: Painel Logístico <nao-responda@suaempresa.com.br> (domínio verificado no Resend)",
      },
    ],
    segredo: "Chave da API do Resend",
  },
  worker_ssw: {
    nome: "worker-ssw",
    descricao:
      "Endereço do worker-ssw e o token de serviço. Sem eles, as ações das telas de ingestão ficam indisponíveis.",
    campos: [{ chave: "url", rotulo: "Endereço", dica: "Ex.: https://worker.ssw.scaleia.ai" }],
    segredo: "Token de serviço",
  },
};

/** Nome de parâmetro que parece segredo: nunca vai em `parametros` (vai cifrado à parte). */
export const CHAVE_COM_CARA_DE_SEGREDO = /(senha|token|secret|segredo|apikey|api_key|password)/i;

/** Logo da empresa: até 512 KB, PNG ou JPEG. */
export const LOGO_MAXIMO_BYTES = 512 * 1024;
