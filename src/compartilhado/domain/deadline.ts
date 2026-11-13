/** De onde veio a previsão de entrega gravada no CT-e. Usada pelo schema e pelo núcleo. */
export const FONTES_DE_PRAZO = [
  "xml_dprog",
  "consulta_prazo_oc80",
  "consulta_prazo_emissao",
  "regra_parceiro",
  "regra_transbordo",
  "regra_unidade",
  "fora_malha",
  "bi2",
  "ssw_manual",
  "ssw_038",
] as const;

export type FontePrazo = (typeof FONTES_DE_PRAZO)[number];
