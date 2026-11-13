/**
 * Job `verificar-token-ssw`: de hora em hora mantém o token da SSW API válido (renova quando faltam
 * 90 min ou menos) e registra a verificação, que acende ou apaga a faixa "Integração SSW
 * indisponível". O "Testar conexão" da tela roda o mesmo job, forçando a renovação.
 * Especificação: docs/regras/06-ingestao.md §3.18.
 */
import {
  baseDaSswApi,
  normalizarCredenciaisSsw,
  precisaRenovarToken,
  previaDoToken,
  tempoRestanteDoToken,
  type TipoDeFalhaSsw,
} from "@erp/domain/ingestion/ssw-api";
import { filaDoJob } from "@erp/shared/ingestion";
import { z } from "@erp/shared/zod";

import { definirJob } from "../../jobs/registro";
import { type Cofre, parametroTexto, segredoDa } from "../comum/integracao";
import { type Buscar, gerarTokenComNovasTentativas, testarTokenComCep } from "./cliente";
import { type CofreDeToken } from "./cofre-de-token";

export const dadosDoTokenSsw = z.object({
  empresaId: z.uuid(),
  /** Manual (botão "Testar conexão") sempre renova. */
  manual: z.boolean().default(false),
});

/** Resultado devolvido ao BullMQ (a API mostra no "Testar conexão"). */
export interface ResultadoDoTokenSsw {
  ok: boolean;
  renovado: boolean;
  mensagem: string;
  tipoFalha: TipoDeFalhaSsw | null;
  tokenPrevia: string | null;
}

export interface DependenciasDoTokenSsw {
  buscar: Buscar;
  cofre: Cofre;
  tokens: CofreDeToken;
  esperar: (ms: number) => Promise<void>;
}

export function criarJobTokenSsw(deps: DependenciasDoTokenSsw) {
  return definirJob({
    nome: "verificar-token-ssw",
    fila: filaDoJob("verificar-token-ssw"),
    // A verificação grava em `empresa_integracoes`, que só a Plataforma altera (RLS).
    escopo: "plataforma",
    dados: dadosDoTokenSsw,
    agendamento: null,
    async processar({ executar, agora, log }, { empresaId, manual }): Promise<ResultadoDoTokenSsw> {
      const integracao = await executar(({ integracoes }) => integracoes.ler(empresaId, "ssw_api"));
      if (!integracao?.ativo) {
        return falha("A integração SSW API está desligada para esta empresa.", null, false);
      }
      const registrar = async (r: ResultadoDoTokenSsw) => {
        await executar(({ integracoes }) =>
          integracoes.registrarVerificacao(empresaId, "ssw_api", {
            em: agora(),
            ok: r.ok,
            mensagem: r.mensagem,
          }),
        );
        log.info({ ok: r.ok, renovado: r.renovado, tipoFalha: r.tipoFalha }, "token da SSW API");
        return r;
      };

      const atual = await deps.tokens.ler(empresaId);
      if (!manual && atual && !precisaRenovarToken(atual.geradoEm, agora())) {
        const minutos = Math.round((tempoRestanteDoToken(atual.geradoEm, agora()) ?? 0) / 60_000);
        return registrar({
          ok: true,
          renovado: false,
          mensagem: `Token válido, expira em ${minutos} min. Sem renovação.`,
          tipoFalha: null,
          tokenPrevia: previaDoToken(atual.token),
        });
      }

      const p = integracao.parametros;
      const normalizadas = normalizarCredenciaisSsw({
        dominio: parametroTexto(p, "dominio") || (integracao.dominioSswDaEmpresa ?? ""),
        usuario: parametroTexto(p, "usuario"),
        cnpjEdi: parametroTexto(p, "cnpj_edi"),
        senha: segredoDa(deps.cofre, empresaId, "ssw_api", integracao) ?? "",
      });
      if (normalizadas.tipo === "erro") {
        return registrar(
          falha(`Falha ao renovar token SSW: ${normalizadas.mensagem}`, null, false),
        );
      }
      // Endereço da integração (vazio = o padrão; ex.: o provisório tms.ssw.inf.br).
      const base = baseDaSswApi(parametroTexto(p, "url"));
      if (base === null) {
        return registrar(
          falha("Falha ao renovar token SSW: endereço da SSW API inválido.", null, false),
        );
      }
      const gerado = await gerarTokenComNovasTentativas(
        deps.buscar,
        base,
        normalizadas.credenciais,
        deps.esperar,
      );
      if (gerado.tipo === "falha") {
        return registrar(
          falha(
            `Falha ao renovar token SSW (${gerado.tipoFalha}): ${gerado.mensagem}`,
            gerado.tipoFalha,
            false,
          ),
        );
      }
      await deps.tokens.gravar(empresaId, gerado.token, agora());
      const teste = await testarTokenComCep(deps.buscar, base, gerado.token);
      const tokenPrevia = previaDoToken(gerado.token);
      if (!teste.ok) {
        return registrar({
          ...falha(
            `Token gerado mas smoke test falhou: ${teste.diagnostico} - ${teste.mensagem || "sem detalhe"}`,
            null,
            true,
          ),
          tokenPrevia,
        });
      }
      return registrar({
        ok: true,
        renovado: true,
        mensagem: "Token renovado com sucesso via generateToken.",
        tipoFalha: null,
        tokenPrevia,
      });
    },
  });
}

function falha(
  mensagem: string,
  tipoFalha: TipoDeFalhaSsw | null,
  renovado: boolean,
): ResultadoDoTokenSsw {
  return { ok: false, renovado, mensagem, tipoFalha, tokenPrevia: null };
}
