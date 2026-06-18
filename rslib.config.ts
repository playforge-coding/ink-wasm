import { defineConfig, rspack, type Rspack } from "@rslib/core";

// Bundles the hand-written TypeScript wrappers together with the Emscripten
// JS glue they import into a pure-ESM package, and emits declaration files.
// The ink.wasm is copied alongside the output; at runtime the wrapper resolves
// it relative to the bundle (see src/locate.ts).
export default defineConfig({
  source: {
    entry: {
      // Stroke engine + renderers (pulls in ink.wasm).
      index: "./src/index.ts",
      // Renderers only — no wasm — for callers that bring their own geometry.
      renderer: "./src/renderer.ts",
    },
  },
  lib: [
    {
      format: "esm",
      bundle: true,
      syntax: "es2022",
      // Declaration files for the public API.
      dts: true,
      output: {
        target: "web",
      },
    },
  ],
  output: {
    // Stable filenames so the ink.wasm sibling resolves predictably.
    filenameHash: false,
    cleanDistPath: true,
    // Emscripten's Node-only code path imports these lazily; keep them
    // external so the web bundle never tries to resolve them.
    externals: [/^node:/],
    // Ship the WebAssembly next to the bundled JS.
    copy: [{ from: "wasm-build/*.wasm", to: "[name][ext]" }],

    // minify with sourcemaps
    minify: {
      js: true,
    },

    sourceMap: {
      // 'json-source-map' is accepted at runtime (emits JSON source maps) but
      // isn't part of rspack's typed `DevTool` union, so cast it through.
      js: "json-source-map" as unknown as Rspack.Configuration["devtool"],
      css: false,
    },
  },
  tools: {
    rspack: {
      module: {
        parser: {
          // Don't let Rspack rewrite `new URL('ink.wasm', import.meta.url)`
          // into a hashed asset — we control wasm resolution ourselves.
          javascript: { url: false },
        },
      },
      plugins: [
        new rspack.CopyRspackPlugin({
          patterns: [
            { from: "./LICENSE", to: "./" },
            { from: "./NOTICE", to: "./" },
            { from: "./README.md", to: "./" },
          ],
        }),
      ],
    },
  },
});
