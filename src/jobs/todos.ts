/** Todos os jobs do worker-ssw. Job novo entra aqui (e, se o ERP puder pedir, no contrato interno). */
import { type Buscar } from "../fontes/bi2/cliente";
import { criarJobBi2_0017 } from "../fontes/bi2/job";
import { type Cofre } from "../fontes/comum/integracao";
import { type CofreDeToken } from "../fontes/ssw-api/cofre-de-token";
import { criarJobTokenSsw } from "../fontes/ssw-api/job";
import { jobWebhookSsw } from "../fontes/webhook/job";
import {
  criarDespachante,
  type Enfileirador as EnfileiradorDoDespachante,
} from "./agendamentos/ingestao";
import { importarColetas050 } from "./coletas/job";
import { criarJobsDaIngestao, type ServicosDaIngestao } from "./ingestao/jobs";
import { limparIngestaoSsw } from "./manutencao/job";
import {
  recalcularProjecoesRomaneio,
  reconstruirProjecoesRomaneio,
} from "./projecoes-romaneio/job";
import { type DefinicaoDeJob } from "./registro";

export interface ServicosDosJobs {
  /** `fetch` do BI2 e da SSW API. */
  buscar: Buscar;
  cofre: Cofre;
  /** Token da SSW API no Redis, cifrado. */
  tokens: CofreDeToken;
  despachante: EnfileiradorDoDespachante;
  ingestao: ServicosDaIngestao;
  esperar: (ms: number) => Promise<void>;
}

export function criarJobs(s: ServicosDosJobs): readonly DefinicaoDeJob[] {
  return [
    criarDespachante(s.despachante),
    criarJobBi2_0017({ buscar: s.buscar, cofre: s.cofre }),
    criarJobTokenSsw({ buscar: s.buscar, cofre: s.cofre, tokens: s.tokens, esperar: s.esperar }),
    jobWebhookSsw,
    ...criarJobsDaIngestao(s.ingestao),
    limparIngestaoSsw,
    recalcularProjecoesRomaneio,
    reconstruirProjecoesRomaneio,
    importarColetas050,
  ];
}
