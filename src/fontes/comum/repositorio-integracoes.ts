import { type Transacao } from "@erp/db";
import { empresaIntegracoes, empresas } from "@erp/db/schema";
import { and, eq } from "drizzle-orm";

import { type RepositorioIntegracoes } from "./integracao";

/** Lê pela empresa explícita: serve ao job da empresa e ao da Plataforma (token da SSW API). */
export function criarRepositorioIntegracoes(tx: Transacao): RepositorioIntegracoes {
  return {
    ler: async (empresaId, tipo) => {
      const [linha] = await tx
        .select({
          ativo: empresaIntegracoes.ativo,
          parametros: empresaIntegracoes.parametros,
          segredoCifrado: empresaIntegracoes.segredoCifrado,
          segredoVersaoChave: empresaIntegracoes.segredoVersaoChave,
          dominioSswDaEmpresa: empresas.dominioSsw,
        })
        .from(empresaIntegracoes)
        .innerJoin(empresas, eq(empresas.id, empresaIntegracoes.empresaId))
        .where(and(eq(empresaIntegracoes.empresaId, empresaId), eq(empresaIntegracoes.tipo, tipo)));
      if (!linha) return null;
      const { segredoCifrado, segredoVersaoChave, ...resto } = linha;
      return {
        ...resto,
        segredo:
          segredoCifrado === null || segredoVersaoChave === null
            ? null
            : { cifrado: segredoCifrado, versaoChave: segredoVersaoChave },
      };
    },
    registrarVerificacao: async (empresaId, tipo, { em, ok, mensagem }) => {
      await tx
        .update(empresaIntegracoes)
        .set({ ultimoTesteEm: em, ultimoTesteOk: ok, ultimoTesteMsg: mensagem.slice(0, 500) })
        .where(and(eq(empresaIntegracoes.empresaId, empresaId), eq(empresaIntegracoes.tipo, tipo)));
    },
  };
}
