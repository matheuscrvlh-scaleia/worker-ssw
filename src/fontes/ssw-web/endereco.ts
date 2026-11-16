/**
 * Endereço do SSW web em que o worker entra: o de Plataforma › Configurações › Integrações › SSW
 * no ERP, o mesmo para todas as empresas. Sem cadastro (ou com endereço inválido), o do ambiente
 * (`SSW_WEB_URL`). Lido a cada login: trocar no ERP vale na rodada seguinte, sem reiniciar.
 */
import { type Transacao } from "@erp/db";
import { plataformaIntegracoes } from "@erp/db/schema";
import { eq } from "drizzle-orm";

import { parametroTexto } from "../comum/integracao";

/** Base sem barra no fim; `padrao` quando o parâmetro `url` falta ou não é http(s). */
export function enderecoDoSswWeb(
  parametros: Record<string, unknown> | null,
  padrao: string,
): string {
  const url = parametros ? parametroTexto(parametros, "url").trim() : "";
  if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) return padrao;
  return url.replace(/\/+$/, "");
}

/** Parâmetros da integração `ssw` da Plataforma; `null` = não cadastrada. */
export async function lerParametrosDoSsw(tx: Transacao): Promise<Record<string, unknown> | null> {
  const [linha] = await tx
    .select({ parametros: plataformaIntegracoes.parametros })
    .from(plataformaIntegracoes)
    .where(eq(plataformaIntegracoes.tipo, "ssw"));
  return linha?.parametros ?? null;
}
