import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const src = (caminho: string) => fileURLToPath(new URL(`./src/${caminho}`, import.meta.url));

export default defineConfig({
  // Os mesmos caminhos do tsconfig.json (cópias do erp-ssw com os imports da origem).
  resolve: {
    alias: [
      { find: /^@erp\/dominio\/nucleo$/, replacement: src("dominio/nucleo/index.ts") },
      { find: /^@erp\/dominio\/(.*)$/, replacement: src("dominio/$1") },
      { find: /^@erp\/shared\/(.*)$/, replacement: src("compartilhado/$1") },
      { find: /^@erp\/db$/, replacement: src("banco/index.ts") },
      { find: /^@erp\/db\/schema$/, replacement: src("banco/schema/index.ts") },
      { find: /^@erp\/db\/segredos$/, replacement: src("banco/segredos.ts") },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
