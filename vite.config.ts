import { defineConfig } from "vite-plus";

// Generated / vendored trees that neither oxlint nor oxfmt should touch:
// the Emscripten glue we compile out of Bazel, the ink submodule, and build
// output.
const generated = [
  "dist/**",
  "wasm-build/**",
  "wasm-build-umd/**",
  "wasm-build-legacy/**",
  "ink/**",
  "examples/dist/**",
];

// Rolldown refuses to code-split a UMD bundle, and UMD needs exactly one
// output file per global. Each UMD entry therefore gets its own pack config
// with splitting turned off; this collects the settings they share.
const umd = {
  format: "umd",
  globalName: "InkWasm",
  platform: "browser",
  minify: true,
  sourcemap: true,
  hash: false,
  outputOptions: {
    codeSplitting: false,
    // Drop rolldown's default `.umd` infix — package.json points consumers at
    // dist/umd/index.js and dist/legacy/index.js.
    entryFileNames: "[name].js",
  },
} as const;

// Two of the three published bundles are built here from the same src/
// wrappers, differing in output format and which Emscripten glue variant (see
// wasm-src/BUILD.bazel) they pull in:
//   - ESM (dist/)     — the primary, wasm-backed package entry.
//   - UMD (dist/umd/) — wasm-backed, for <script> tags / CJS / AMD consumers
//                       that can't use ES modules.
// Both are minified with sourcemaps and share the same platform/asset
// handling; only `entry`, `format`/`globalName`, `target` and `outDir` differ.
//
// The third — the wasm-free asm.js fallback in dist/legacy/ — is built by
// scripts/build-legacy.mjs instead, because tsdown's tree-shaking miscompiles
// Emscripten's wasm2js output and can't be turned off. See that file.
export default defineConfig({
  pack: [
    {
      name: "esm",
      format: "esm",
      platform: "browser",
      target: "es2022",
      entry: {
        // Stroke engine + renderers (pulls in ink.wasm).
        index: "./src/index.ts",
        // Renderers only — no wasm — for callers that bring their own geometry.
        renderer: "./src/renderer.ts",
      },
      outDir: "dist",
      // Declaration files for the public API. Unlike the JS sourcemaps below,
      // .d.ts.map carries no `sourcesContent`, so it would only point at a
      // src/ tree we don't publish — keep declaration maps off. (tsdown still
      // writes the `sourceMappingURL` comment because `sourcemap` is on; a
      // missing map file is ignored by TypeScript.)
      dts: { sourcemap: false },
      minify: true,
      sourcemap: true,
      // Stable filenames so the ink.wasm sibling resolves predictably.
      hash: false,
      outputOptions: {
        // The declarations shared by both entries are hoisted into a chunk,
        // and rolldown would otherwise name it after its largest member —
        // `renderer.d.ts` — pushing the actual `renderer` entry out to
        // `renderer2.d.ts` and breaking the "./renderer" types export.
        chunkFileNames: "[name]-chunk.js",
      },
      deps: {
        // Emscripten's Node-only code path imports these lazily; keep them
        // external so the web bundle never tries to resolve them.
        neverBundle: [/^node:/],
      },
      copy: [
        // Ship the WebAssembly next to the bundled JS.
        { from: "wasm-build/ink.wasm", to: "dist" },
        { from: ["LICENSE", "NOTICE", "README.md"], to: "dist" },
      ],
    },
    {
      ...umd,
      name: "umd",
      target: "es2018",
      entry: { index: "./src/index.umd.ts" },
      outDir: "dist/umd",
      copy: [{ from: "wasm-build-umd/ink_umd.wasm", to: "dist/umd" }],
    },
    {
      ...umd,
      name: "umd:renderer",
      target: "es2018",
      entry: { renderer: "./src/renderer.ts" },
      outDir: "dist/umd",
      // The sibling `umd` config owns dist/umd; clearing it here would race
      // with (and delete) that build's output.
      clean: false,
    },
  ],
  lint: {
    ignorePatterns: generated,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: generated,
  },
});
