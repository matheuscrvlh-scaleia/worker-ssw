/**
 * Gravações da recepção do webhook SSW2181 (rota pública). Movido de
 * erp-ssw/apps/api/src/modulos/ingestao-ssw/repositorio.ts (só a parte da recepção).
 */
import { type Transacao } from "@erp/db";
import { empresaIntegracoes, empresas, sswWebhookEventos } from "@erp/db/schema";
import { and, count, eq, gte, isNotNull } from "drizzle-orm";

import { type EmpresaDoWebhook, type EventoRecebido } from "./recepcao";

export interface RepositorioRecepcaoWebhook {
  /** Empresas com a integração `ssw_webhook` cadastrada (contexto da Plataforma). */
  empresasComWebhook(): Promise<EmpresaDoWebhook[]>;
  registrarEvento(evento: EventoRecebido): Promise<string>;
  /** Eventos não autenticados com conteúdo guardado (quarentena) desde o instante. */
  quarentenaDesde(desde: Date): Promise<number>;
  marcarEvento(eventoId: string, statusHttp: number, erro: string): Promise<void>;
}

export function criarRepositorioRecepcaoWebhook(tx: Transacao): RepositorioRecepcaoWebhook {
  return {
    empresasComWebhook: async () => {
      const linhas = await tx
        .select({
          id: empresas.id,
          slug: empresas.slug,
          nome: empresas.nome,
          status: empresas.status,
          integracaoAtiva: empresaIntegracoes.ativo,
          parametros: empresaIntegracoes.parametros,
          segredoCifrado: empresaIntegracoes.segredoCifrado,
          segredoVersaoChave: empresaIntegracoes.segredoVersaoChave,
        })
        .from(empresas)
        .innerJoin(
          empresaIntegracoes,
          and(
            eq(empresaIntegracoes.empresaId, empresas.id),
            eq(empresaIntegracoes.tipo, "ssw_webhook"),
          ),
        )
        .orderBy(empresas.criadoEm, empresas.id);
      return linhas.map(({ segredoCifrado, segredoVersaoChave, ...e }) => ({
        ...e,
        segredo:
          segredoCifrado === null || segredoVersaoChave === null
            ? null
            : { cifrado: segredoCifrado, versaoChave: segredoVersaoChave },
      }));
    },

    registrarEvento: async (e) => {
      const [linha] = await tx
        .insert(sswWebhookEventos)
        .values({ ...e, payloadBruto: e.payloadBruto ?? null })
        .returning({ id: sswWebhookEventos.id });
      if (!linha) throw new Error("Gravação do evento do webhook não devolveu a linha.");
      return linha.id;
    },

    quarentenaDesde: async (desde) => {
      const [linha] = await tx
        .select({ n: count() })
        .from(sswWebhookEventos)
        .where(
          and(
            eq(sswWebhookEventos.autenticado, false),
            isNotNull(sswWebhookEventos.payloadBruto),
            gte(sswWebhookEventos.recebidoEm, desde),
          ),
        );
      return linha?.n ?? 0;
    },

    marcarEvento: async (eventoId, statusHttp, erro) => {
      await tx
        .update(sswWebhookEventos)
        .set({ statusHttp, erroProcessamento: erro.slice(0, 2000) })
        .where(eq(sswWebhookEventos.id, eventoId));
    },
  };
}
