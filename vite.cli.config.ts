// Builds the `todoom` command into one file, dist-cli/todoom.mjs, with its
// dependencies inside: it runs with a plain `node`, no install needed.
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: { __TODOOM_VERSION__: JSON.stringify(version) },
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: "cli/todoom.ts",
    outDir: "dist-cli",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      output: { format: "es", entryFileNames: "todoom.mjs", banner: "#!/usr/bin/env node", inlineDynamicImports: true },
    },
  },
});
