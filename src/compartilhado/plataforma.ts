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

interface InfoDaIntegracao {
  nome: string;
  descricao: string;
  campos: readonly { chave: string; rotulo: string; lista?: boolean; dica?: string }[];
  /** Rótulo do segredo (senha/token); sem ele a integração não tem segredo próprio. */
  segredo?: string;
  /** Tela que opera essa integração. */
  tela?: string;
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
  },
  ssw_api: {
    nome: "SSW API",
    descricao: "Consulta de rastreamento e ocorrências na API do SSW.",
    campos: [
      { chave: "dominio", rotulo: "Domínio" },
      { chave: "usuario", rotulo: "Usuário" },
      { chave: "cnpj_edi", rotulo: "CNPJ EDI" },
    ],
    segredo: "Senha da SSW API",
    tela: "/admin/ssw-diagnostico",
  },
  ssw_bi2: {
    nome: "SSW BI2",
    descricao: "API CSV do BI2 (CT-e, 0013, 0017, 0174, 0220).",
    campos: [{ chave: "dominio", rotulo: "Domínio", dica: "Ex.: FRT" }],
    segredo: "Token do BI2",
    tela: "/admin/ingestao",
  },
  ssw_webhook: {
    nome: "Webhook SSW",
    descricao: "Ocorrências enviadas pelo SSW em tempo real.",
    campos: [
      { chave: "cnpjs_aceitos", rotulo: "CNPJs aceitos", lista: true, dica: "Separe por vírgula" },
    ],
    segredo: "Segredo do webhook",
    tela: "/admin/ingestao",
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
  },
  ingestao_publica: {
    nome: "Rotas públicas da ingestão",
    descricao:
      "Segredo que quem chama /api/public/ftp-relatorio-import, ssw-ciclo-aplicar e xml-orfaos-retry manda no cabeçalho x-ftp-ingest-secret (ou x-cron-token). Identifica a empresa.",
    campos: [],
    segredo: "Segredo das rotas públicas",
  },
};

/** Nome de parâmetro que parece segredo: nunca vai em `parametros` (vai cifrado à parte). */
export const CHAVE_COM_CARA_DE_SEGREDO = /(senha|token|secret|segredo|apikey|api_key|password)/i;

/** Logo da empresa: até 512 KB, PNG ou JPEG. */
export const LOGO_MAXIMO_BYTES = 512 * 1024;
