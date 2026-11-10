import { type z } from "./zod";

type Metodo = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Contrato de um endpoint: a API valida com ele e o web chama por ele, então os dois lados não
 * divergem. `entrada` é a query string em GET/DELETE e o corpo nos demais; `parametros` são os
 * segmentos `:nome` do caminho.
 */
export interface Contrato {
  metodo: Metodo;
  caminho: `/api/${string}`;
  parametros?: z.ZodObject;
  entrada?: z.ZodType;
  saida: z.ZodType;
}

export function contrato<const C extends Contrato>(definicao: C): C {
  return definicao;
}

export type EntradaDe<C extends Contrato> = C["entrada"] extends z.ZodType
  ? z.input<C["entrada"]>
  : undefined;

export type ParametrosDe<C extends Contrato> = C["parametros"] extends z.ZodObject
  ? z.input<C["parametros"]>
  : undefined;

export type SaidaDe<C extends Contrato> = z.output<C["saida"]>;

/** `/api/v1/x/:id` + `{ id: "7" }` → `/api/v1/x/7` (cada valor vai codificado). */
export function montarCaminho(caminho: string, parametros?: Record<string, string>): string {
  return caminho.replace(/:([A-Za-z_]+)/g, (_trecho, nome: string) => {
    const valor = parametros?.[nome];
    if (valor === undefined) throw new Error(`Parâmetro ausente no caminho: ${nome}`);
    return encodeURIComponent(valor);
  });
}

/** A entrada vai no corpo (POST/PUT/PATCH) ou na query string (GET/DELETE). */
export function usaCorpo(metodo: Metodo): boolean {
  return metodo !== "GET" && metodo !== "DELETE";
}
