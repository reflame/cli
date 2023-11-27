import * as path_ from "node:path";
import * as esbuild_ from "esbuild";

const jsoncParserPlugin = {
  name: "jsonc-parser",
  setup(build) {
    build.onResolve(
      { filter: /^jsonc-parser$/, namespace: "file" },
      async (args) => ({
        // Bun's import.meta.resolve returns a path string instead of a URL
        // path: url_.fileURLToPath(
        //   new URL('../esm/main.js', await import.meta.resolve('jsonc-parser')),
        // ),
        path: path_.resolve(
          path_.dirname(await import.meta.resolve("jsonc-parser")),
          "../esm/main.js"
        ),
        namespace: "file",
      })
    );
  },
};

await Promise.all([
  esbuild_.build({
    entryPoints: ["app/deps.mjs"],
    outExtension: {
      ".js": ".mjs",
    },
    minifyWhitespace: false,
    minifyIdentifiers: false,
    minifySyntax: true,
    bundle: true,
    platform: "node",
    define: {
      "process.env.NODE_ENV": `"production"`,
    },
    plugins: [jsoncParserPlugin],
    format: "esm",
    outdir: "build",
  }),
  esbuild_.build({
    entryPoints: ["app/entry.ts"],
    outExtension: {
      ".js": ".mjs",
    },
    minifyWhitespace: false,
    minifyIdentifiers: false,
    minifySyntax: true,
    bundle: false,
    // banner: {
    //   js: "#!/usr/bin/env node",
    // },
    platform: "node",
    define: {
      "process.env.NODE_ENV": `"production"`,
    },
    format: "esm",
    outdir: "build",
  }),
]);
