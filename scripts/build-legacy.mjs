// build-legacy.mjs — bundle the wasm-free (asm.js) fallback into
// dist/legacy/index.js.
//
// The other two bundles (ESM, UMD) are built by `vp pack` from the `pack`
// block in vite.config.ts. This one can't be, and the reason is specific:
//
// The legacy variant links Emscripten's WASM=0 output, i.e. ~1.3 MB of
// machine-generated wasm2js code (see wasm-src/BUILD.bazel). Rolldown's
// tree-shaking pass miscompiles that code — among other things it drops
// `continue` statements from `while (1)` bodies inside labeled blocks — and
// the resulting bundle loads fine but calls `abort()` partway through the
// first stroke. tsdown always enables tree-shaking (its `treeshake: false`,
// `inputOptions.treeshake` and `vp pack --treeshake=false` are all ignored as
// of Vite+ 0.2.8 / tsdown 0.22), so there is no way to build this bundle
// through `vp pack` today. oxc's minifier `compress` pass has the same effect,
// which is why `minify` below disables it and keeps only mangling + codegen —
// that still gets the bundle down to roughly the size a full minify would.
//
// So we drive Rolldown — the bundler Vite+ itself runs — directly, with
// tree-shaking off. Nothing is lost by that here: the bundle is one entry
// pulling in one self-contained glue file, so there is no dead code to shake.
// Drop this script and move the config back into vite.config.ts's `pack`
// block once tsdown lets `treeshake: false` through.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { ROOT } from "./common.mjs";

// Rolldown ships inside Vite+ rather than as a direct dependency of this
// package, so resolve it through vite-plus's own module tree (pnpm's layout
// won't let us import it by bare specifier from here).
const require = createRequire(import.meta.url);
const fromVitePlus = createRequire(require.resolve("vite-plus/package.json"));
const { rolldown } = await import(fromVitePlus.resolve("@voidzero-dev/vite-plus-core/rolldown"));

const bundle = await rolldown({
  input: resolve(ROOT, "src/index.legacy.ts"),
  cwd: ROOT,
  platform: "browser",
  // Load-bearing — see the header comment.
  treeshake: false,
  // Widest compatibility: this bundle exists specifically for browsers too old
  // to run WebAssembly, so downlevel as far as oxc goes (es2015 is its floor;
  // the asm.js glue that dominates the output is already ES5 either way).
  transform: { target: "es2015" },
});

await bundle.write({
  dir: resolve(ROOT, "dist/legacy"),
  format: "umd",
  name: "InkWasm",
  // Match the ESM/UMD bundles: package.json points at dist/legacy/index.js.
  entryFileNames: "index.js",
  // `compress` is the DCE pass that breaks wasm2js; mangling and codegen are
  // safe and do nearly all of the size reduction.
  minify: { compress: false, mangle: true, codegen: true },
  sourcemap: true,
});
await bundle.close();

console.log("✓ Wrote dist/legacy/index.js (asm.js fallback)");
