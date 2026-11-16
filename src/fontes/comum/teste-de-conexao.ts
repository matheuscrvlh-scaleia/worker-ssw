/**
 * Job `testar-conexao` (botão "Testar conexão" de Plataforma › Empresa › Integrações no ERP):
 * entra no SSW web com a credencial do Worker SSW, ou consulta o 0017 de hoje no BI2 com o token
 * da empresa. Não lança nem repete: o resultado vai para a tela e para `ultimo_teste_*`.
 */
import { hojeSp } from "@erp/domain/core";
import { z } from "@erp/shared/zod";

import { type ResultadoDoTesteDeConexao } from "../../contrato-interno";
import { definirJob } from "../../jobs/registro";
import {
  type Buscar,
  buscarRelatorioBi2,
  type RespostaDoBi2,
  urlDoRelatorio,
} from "../bi2/cliente";
import { CODIGO_DO_0017 } from "../bi2/relatorio-0017";
import { configuracaoSswWeb } from "../ssw-web/parametros";
import { type NavegadorSswWeb } from "../ssw-web/rodada";
import { type Cofre, type IntegracaoGravada, parametroTexto, segredoDa } from "./integracao";

export interface DependenciasDoTeste {
  buscar: Buscar;
  cofre: Cofre;
  /** O Chromium do SSW web é o da ingestão (lido na hora do teste). */
  ingestao: { sswWeb: NavegadorSswWeb };
}

const mensagemDe = (erro: unknown) =>
  (erro instanceof Error ? erro.message : String(erro)).split("\n")[0] ?? "erro desconhecido";

/** 404 do BI2 = respondeu, sem o relatório de hoje ainda; 401/403 = token recusado. */
export function resultadoDoBi2(resposta: RespostaDoBi2): ResultadoDoTesteDeConexao {
  if (resposta.tipo === "ok") return { ok: true, mensagem: "O BI2 respondeu com o 0017 de hoje." };
  if (resposta.tipo === "falha") {
    return { ok: false, mensagem: `BI2 fora do ar: ${resposta.mensagem}` };
  }
  if (resposta.status === 404) {
    return { ok: true, mensagem: "O BI2 respondeu; ainda não há 0017 de hoje." };
  }
  if (resposta.status === 401 || resposta.status === 403) {
    return { ok: false, mensagem: `O BI2 recusou o token (HTTP ${String(resposta.status)}).` };
  }
  return {
    ok: false,
    mensagem: `BI2 respondeu HTTP ${String(resposta.status)}: ${resposta.corpo.slice(0, 200)}`,
  };
}

async function testarBi2(
  deps: DependenciasDoTeste,
  empresaId: string,
  integracao: IntegracaoGravada,
  agora: Date,
): Promise<ResultadoDoTesteDeConexao> {
  const token = segredoDa(deps.cofre, empresaId, "ssw_bi2", integracao);
  if (!token) return { ok: false, mensagem: "Token do BI2 não cadastrado." };
  const dominio =
    parametroTexto(integracao.parametros, "dominio") || (integracao.dominioSswDaEmpresa ?? "");
  const url = urlDoRelatorio(dominio, "cliente", CODIGO_DO_0017, hojeSp(agora));
  return resultadoDoBi2(await buscarRelatorioBi2(deps.buscar, { url, token }));
}

async function testarSswWeb(
  deps: DependenciasDoTeste,
  empresaId: string,
  integracao: IntegracaoGravada,
): Promise<ResultadoDoTesteDeConexao> {
  const senha = segredoDa(deps.cofre, empresaId, "ssw_web", integracao);
  const lida = configuracaoSswWeb(integracao, senha);
  if (!lida.ok) return { ok: false, mensagem: lida.mensagem };
  const sessao = await deps.ingestao.sswWeb.entrar(lida.config);
  await sessao.fechar();
  return { ok: true, mensagem: "Login no SSW web aceito." };
}

export function criarJobTesteDeConexao(deps: DependenciasDoTeste) {
  return definirJob({
    nome: "testar-conexao",
    fila: "testes",
    // O resultado vai para `empresa_integracoes`, que só a Plataforma altera (RLS); a leitura é
    // pela empresa explícita.
    escopo: "plataforma",
    dados: z.object({ empresaId: z.uuid(), integracao: z.enum(["ssw_web", "ssw_bi2"]) }),
    agendamento: null,
    async processar({ executar, agora, log }, { empresaId, integracao: tipo }) {
      const integracao = await executar(({ integracoes }) => integracoes.ler(empresaId, tipo));
      const r: ResultadoDoTesteDeConexao = !integracao
        ? { ok: false, mensagem: "Integração não cadastrada nesta empresa." }
        : await (
            tipo === "ssw_bi2"
              ? testarBi2(deps, empresaId, integracao, agora())
              : testarSswWeb(deps, empresaId, integracao)
          ).catch((erro: unknown) => ({ ok: false, mensagem: mensagemDe(erro) }));
      if (integracao) {
        await executar(({ integracoes }) =>
          integracoes.registrarVerificacao(empresaId, tipo, { em: agora(), ...r }),
        );
      }
      log.info({ integracao: tipo, ok: r.ok }, "teste de conexão");
      return r;
    },
  });
}
