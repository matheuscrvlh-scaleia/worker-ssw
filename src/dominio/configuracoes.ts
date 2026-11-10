import { ErroDeNegocio } from "./erros";

/**
 * Configurações por empresa: validação do valor digitado no Admin, o que a tela mostra, o que
 * qualquer usuário lê e o que a empresa nova herda da empresa modelo.
 * origem: configuracoes.functions.ts, config.server.ts, empresa_semear (sistema atual)
 */

/** Lidas por qualquer usuário da empresa (limiares e alertas das telas). */
export const CHAVES_PUBLICAS: readonly string[] = [
  "sla_meta_pct",
  "sla_alerta_amarelo_pct",
  "sla_alerta_vermelho_pct",
  "taxa_retorno_meta_pct",
  "romaneio_peso_critico_kg",
  "romaneio_volume_critico",
  "alerta_dias_sem_movimento",
  "ranking_threshold_positivo_pct",
  "ranking_threshold_atencao_pct",
  "ranking_threshold_critico_pct",
  "alerta_queda_sla_pp",
  "alerta_janela_tendencia_dias",
  "alerta_janela_vencimento_h",
  "alerta_min_vencimento",
  "alerta_nascido_atrasado",
  "alerta_desvio_finsistema_pp",
  "alerta_dias_sem_atualizacao",
  "otif_visivel",
];

/** A empresa nova copia da modelo estes grupos, menos as chaves de infraestrutura. */
const GRUPOS_COPIADOS_NA_CRIACAO: readonly string[] = [
  "performance",
  "operacional",
  "ranking",
  "notificacoes",
  "empresa",
];
const CHAVES_NAO_COPIADAS: ReadonlySet<string> = new Set([
  "app_base_url",
  "edge_functions_url",
  "edge_apikey",
  "backfill_cron_token",
]);

export function copiaParaEmpresaNova(c: { chave: string; grupo: string }): boolean {
  return GRUPOS_COPIADOS_NA_CRIACAO.includes(c.grupo) && !CHAVES_NAO_COPIADAS.has(c.chave);
}

const RESPONSABILIDADES = new Set([
  "cliente",
  "destinatario",
  "sistema",
  "FR",
  "transportador",
  "pendente",
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalido = (mensagem: string) => new ErroDeNegocio("ENTRADA_INVALIDA", mensagem);

function listaCsv(valor: string): string[] {
  return valor
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normaliza e valida o valor de uma chave. Numérico por padrão: `_pct` de 0 a 100, `_pp` inteiro
 * de 0 a 100, demais inteiros não negativos. `Number("")` é 0, então vazio vira "0".
 * origem: validarValor (configuracoes.functions.ts, sistema atual)
 */
export function validarValorDeConfiguracao(chave: string, valor: string): string {
  const texto = valor.trim();
  if (chave === "whatsapp_horario_envio") {
    const m = /^(\d{2}):(\d{2})$/.exec(texto);
    if (!m) throw invalido(`"${chave}" precisa estar no formato HH:MM`);
    const [, hora = "", minuto = ""] = m;
    if (Number(hora) > 23 || Number(minuto) > 59) {
      throw invalido(`"${chave}" tem hora/minuto inválidos`);
    }
    return `${hora}:${minuto}`;
  }
  if (chave === "atrasos_excluir_responsabilidades") {
    const partes = listaCsv(texto);
    for (const p of partes) {
      if (!RESPONSABILIDADES.has(p)) {
        throw invalido(
          `"${chave}" contém responsabilidade inválida: "${p}". Válidos: cliente, destinatario, sistema, FR, transportador, pendente.`,
        );
      }
    }
    return partes.join(",");
  }
  if (chave === "parceiros_estrategicos") {
    const partes = listaCsv(texto);
    for (const p of partes) {
      if (!UUID.test(p)) throw invalido(`"${chave}" contém UUID inválido: "${p}"`);
    }
    return partes.join(",");
  }
  const n = Number(texto);
  if (!Number.isFinite(n)) throw invalido(`"${chave}" precisa ser numérico`);
  if (chave.endsWith("_pct")) {
    if (n < 0 || n > 100) throw invalido(`"${chave}" deve estar entre 0 e 100`);
  } else if (chave.endsWith("_pp")) {
    if (n < 0 || n > 100) throw invalido(`"${chave}" deve estar entre 0 e 100`);
    if (!Number.isInteger(n)) throw invalido(`"${chave}" precisa ser inteiro`);
  } else {
    if (n < 0) throw invalido(`"${chave}" não pode ser negativo`);
    if (!Number.isInteger(n)) throw invalido(`"${chave}" precisa ser inteiro`);
  }
  return String(n);
}

/** Linha de `configuracoes`: da empresa ou da Plataforma (empresa nula, o padrão). */
export interface ConfiguracaoLida {
  empresaId: string | null;
  chave: string;
  valor: string;
}

/**
 * Valor vigente de cada chave: o da empresa vence o padrão da Plataforma.
 * origem: leitura de `configuracoes` nas RPCs (sistema atual)
 */
export function configuracoesVigentes(linhas: readonly ConfiguracaoLida[]): Map<string, string> {
  const vigentes = new Map<string, string>();
  for (const l of linhas) if (l.empresaId === null) vigentes.set(l.chave, l.valor);
  for (const l of linhas) if (l.empresaId !== null) vigentes.set(l.chave, l.valor);
  return vigentes;
}
