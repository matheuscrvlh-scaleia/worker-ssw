// Empacota o worker-ssw num único ESM. Os caminhos @erp/* (cópias do erp-ssw) vêm do
// tsconfig.json e entram no bundle; as dependências de node_modules ficam de fora (instaladas na
// imagem).
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  tsconfig: "tsconfig.json",
  plugins: [
    {
      name: "dependencias-externas",
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.path.startsWith("@erp/") ? undefined : { path: args.path, external: true },
        );
      },
    },
  ],
});
