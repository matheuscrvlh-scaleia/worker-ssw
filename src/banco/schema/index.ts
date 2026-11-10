/**
 * Cópia das tabelas do schema `erp` que o worker-ssw lê ou grava, só com as colunas (índices,
 * restrições, FKs e políticas RLS são do ERP, dono do schema). Origem de cada arquivo:
 * erp-ssw/packages/db/src/schema (README, "Arquivos copiados"). O boot confere estas definições
 * contra o banco (`../contrato-de-schema.ts`).
 */
export * from "./bi2";
export * from "./codigos-ocorrencia";
export * from "./coletas";
export * from "./ctes";
export * from "./feriados";
export * from "./filiais";
export * from "./ingestao";
export * from "./ocorrencias";
export * from "./parceiros";
export * from "./plataforma";
export * from "./projecoes";
export * from "./ssw";
export * from "./xml-cte";
