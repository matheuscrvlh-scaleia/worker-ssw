/**
 * O que as rotas públicas da ingestão usam de fora: transação no contexto da empresa (ator:
 * sistema), empresas para a decisão da rota, segredos da `ingestao_publica` e a fila de jobs.
 * Produção monta em `main.ts`; os testes passam falsos.
 */
import {
  type EmpresaParaIngestao,
  type Enfileirador,
  type Transacional,
} from "../../aplicacao/casos-de-uso";

export interface ServicosDaIngestao {
  executarNaEmpresa(empresaId: string): Transacional;
  /** Empresas com status e integrações ligadas (contexto da Plataforma). */
  empresasParaIngestao(): Promise<EmpresaParaIngestao[]>;
  /**
   * Segredos decifrados da integração `ingestao_publica` ligada, um por empresa: é o segredo que
   * diz qual empresa chama as rotas públicas.
   */
  segredosDaIngestao(): Promise<SegredoDaIngestao[]>;
  enfileirador: Enfileirador;
}

export interface SegredoDaIngestao {
  empresaId: string;
  segredo: string;
}
