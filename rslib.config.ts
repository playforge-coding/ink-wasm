import { defineConfig, rspack, type Rspack } from "@rslib/core";

// Don't let Rspack rewrite `new URL('ink.wasm', import.meta.url)` into a
// hashed asset — we control wasm resolution ourselves (src/locate.ts).
const disableUrlAsset: Rspack.Configuration["module"] = {
  parser: { javascript: { url: false } },
};

const copyLicenseFiles = new rspack.CopyRspackPlugin({
  patterns: [
    { from: "./LICENSE", to: "./" },
    { from: "./NOTICE", to: "./" },
    { from: "./README.md", to: "./" },
  ],
});

// Three bundles, all built from the same src/ wrappers, differing in output
// format and which Emscripten glue variant (see wasm-src/BUILD.bazel) they
// pull in:
//   - ESM   (dist/)        — the primary, wasm-backed package entry.
//   - UMD   (dist/umd/)    — wasm-backed, for <script> tags / CJS / AMD
//                            consumers that can't use ES modules.
//   - UMD   (dist/legacy/) — asm.js, no WebAssembly at all, for browsers
//                            that don't support wasm. Also UMD, since a
//                            browser too old for wasm won't have ES modules
//                            either.
// Each is minified with sourcemaps and shares the same externals/asset
// handling; only `source.entry`, `format`/`umdName` and `output` differ.
export default defineConfig({
  lib: [
    {
      format: "esm",
      bundle: true,
      syntax: "es2022",
      // Declaration files for the public API.
      dts: true,
      source: {
        entry: {
          // Stroke engine + renderers (pulls in ink.wasm).
          index: "./src/index.ts",
          // Renderers only — no wasm — for callers that bring their own geometry.
          renderer: "./src/renderer.ts",
        },
      },
      output: {
        target: "web",
        // Stable filenames so the ink.wasm sibling resolves predictably.
        filenameHash: false,
        cleanDistPath: true,
        distPath: "dist",
        // Emscripten's Node-only code path imports these lazily; keep them
        // external so the web bundle never tries to resolve them.
        externals: [/^node:/],
        // Ship the WebAssembly next to the bundled JS.
        copy: [{ from: "wasm-build/*.wasm", to: "[name][ext]" }],
        minify: { js: true },
        sourceMap: {
          // 'json-source-map' is accepted at runtime (emits JSON source maps)
          // but isn't part of rspack's typed `DevTool` union, so cast it through.
          js: "json-source-map" as unknown as Rspack.Configuration["devtool"],
          css: false,
        },
      },
      tools: {
        rspack: { module: disableUrlAsset, plugins: [copyLicenseFiles] },
      },
    },
    {
      format: "umd",
      umdName: "InkWasm",
      bundle: true,
      syntax: "es2018",
      source: {
        entry: {
          index: "./src/index.umd.ts",
          renderer: "./src/renderer.ts",
        },
      },
      output: {
        target: "web",
        filenameHash: false,
        cleanDistPath: true,
        distPath: "dist/umd",
        copy: [{ from: "wasm-build-umd/*.wasm", to: "[name][ext]" }],
        minify: { js: true },
        sourceMap: {
          js: "json-source-map" as unknown as Rspack.Configuration["devtool"],
          css: false,
        },
      },
      tools: {
        rspack: { module: disableUrlAsset },
      },
    },
    {
      format: "umd",
      umdName: "InkWasm",
      bundle: true,
      // Widest compatibility: this bundle exists specifically for browsers
      // too old to run WebAssembly, so downlevel as far as Rslib allows.
      syntax: "es5",
      source: {
        entry: {
          index: "./src/index.legacy.ts",
        },
      },
      output: {
        target: "web",
        filenameHash: false,
        cleanDistPath: true,
        distPath: "dist/legacy",
        // No wasm to copy — the asm.js glue is self-contained JS.
        minify: { js: true },
        sourceMap: {
          js: "json-source-map" as unknown as Rspack.Configuration["devtool"],
          css: false,
        },
      },
    },
  ],
});
