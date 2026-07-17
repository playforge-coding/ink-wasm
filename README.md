# ink-wasm

Build [Google Ink](https://github.com/google/ink) — Google's freehand stroke
generation library (the C++ engine behind Android's Jetpack Ink, and the same
family of tech used by Google Keep / Chrome Canvas) — for **WebAssembly**.

Google Ink is a Bazel 7+/bzlmod C++20 project with no built-in JS bindings. The
Node scripts in `scripts/` add an Emscripten toolchain to its Bazel build,
compile the core stroke pipeline to wasm, and expose it to JavaScript via Embind.
The TypeScript wrappers in `src/` are then bundled together with the Emscripten
glue by [Rslib](https://lib.rsbuild.dev/) into three packages — ESM, UMD, and a
wasm-free UMD fallback for legacy browsers — with TypeScript types and a choice
of rendering backends (Canvas2D or CanvasKit/Skia).

## Install

The published package ships the **prebuilt** wasm — you do not need Bazel or
Emscripten to use it, only to rebuild it.

```bash
pnpm add ink-wasm
# or: npm install ink-wasm / yarn add ink-wasm
```

```js
import { createInk, createCanvas2dBackend } from "ink-wasm";

const ink = await createInk();

const mesh = ink.generateStrokeMesh(
  [ { x: 10, y: 10, t: 0 }, { x: 60, y: 50, t: 0.04 }, { x: 120, y: 60, t: 0.08 } ],
  "marker",        // "marker" | "pressure_pen" | "highlighter"
  0.1, 0.4, 0.9, 1, // rgba, 0..1
  4,                // brush size
  0.1,              // simplification epsilon
);

const backend = createCanvas2dBackend(canvas);
backend.clear();
backend.drawMesh(mesh, { r: 0.1, g: 0.4, b: 0.9, a: 1 });
backend.present();
```

`createInk` loads `ink.wasm` lazily relative to the bundle URL; with any modern
bundler (Vite, webpack, esbuild) or in Node it resolves automatically. If you
serve the wasm from a custom location pass `locateFile`, or hand it the bytes
directly with `wasmBinary`:

```js
const ink = await createInk({ locateFile: (f) => `/assets/${f}` });
```

Entry points:

| Import | What it is | Types |
| --- | --- | --- |
| `ink-wasm` | stroke engine (`createInk`) + both renderers (`dist/index.js` + `dist/ink.wasm`) | `dist/index.d.ts` |
| `ink-wasm/renderer` | Canvas2D + CanvasKit rendering backends only, no wasm (`dist/renderer.js`) | `dist/renderer.d.ts` |
| `ink-wasm/ink.wasm` | the raw wasm binary (for bundler URL/asset handling) | — |
| `ink-wasm/umd` | same API as `ink-wasm`, as a UMD bundle (`dist/umd/index.js` + `dist/umd/ink_umd.wasm`) — for a plain `<script>` tag, CommonJS `require()`, or AMD, instead of ES modules | `dist/index.umd.d.ts` |
| `ink-wasm/umd/renderer` | renderer-only UMD bundle, no wasm (`dist/umd/renderer.js`) | `dist/renderer.d.ts` |
| `ink-wasm/legacy` | same API again, but **no WebAssembly at all** — the whole engine compiled to asm.js (`dist/legacy/index.js`, no `.wasm` sibling) — for browsers that can't run wasm | `dist/index.legacy.d.ts` |

The package also sets `unpkg`/`jsdelivr` to the UMD build, so a CDN `<script>`
tag works out of the box:

```html
<script src="https://unpkg.com/ink-wasm/dist/umd/index.js"></script>
<script>
  InkWasm.createInk().then((ink) => { /* ... */ });
</script>
```

`ink-wasm/legacy` exists specifically for browsers without WebAssembly
support: it ships the same Embind API (`createInk`, `generateStrokeMesh`,
the renderers) but the stroke pipeline runs as plain JS (asm.js) instead of
wasm. It's ~1.3 MB unminified-equivalent vs. ~30 KB + 580 KB wasm for the
other builds, and noticeably slower — use it only as a fallback, e.g. behind
an `if (!window.WebAssembly)` check:

```html
<script>
  if (!window.WebAssembly) document.write('<script src="/dist/legacy/index.js">\x3C/script>');
  else document.write('<script src="/dist/umd/index.js">\x3C/script>');
</script>
```

The rest of this document covers **building the wasm from source**.

## Requirements

- **Node.js** 18+
- **Bazel** (or `bazelisk`) on `PATH` — the build is driven through Google Ink's
  own Bazel setup
- **git**
- A C/C++ host toolchain (Google Ink registers its own LLVM toolchain; Bazel
  still needs basics)

Emscripten itself is **downloaded by Bazel** (via the `emsdk` module) — you do
**not** need a system `emcc`.

## Usage

```bash
pnpm install
pnpm setup        # clone Google Ink, register emsdk, stage the //wasm targets
pnpm build:wasm   # bazel build -> wasm-build*/ink.{js,cjs} + .wasm + .d.ts (x3 variants)
pnpm build:js     # rslib bundle -> dist/, dist/umd/, dist/legacy/
pnpm test         # run the pipeline in Node against the built ESM bundle
```

`pnpm build` runs all three build steps in order (cloning + patching ink first
if needed). The first build downloads the Emscripten toolchain plus the
abseil/protobuf dependency tree, so it takes a while; subsequent builds are
incremental — `build:wasm` compiles three variants (ESM, UMD, wasm-free
legacy) from the same C++ source in one `bazel build` invocation, sharing
cached compilation of the ink/abseil/skia dependency tree, so adding the UMD
and legacy variants costs one extra link step each, not a full rebuild.
`pnpm clean` removes `dist/`, all `wasm-build*/` dirs and the `ink/` checkout.

### Browser demo

```bash
pnpm serve        # copies dist/ into examples/ and serves it
```

Open `http://localhost:3000/index.html`.

Draw with the mouse — strokes are meshed by Google Ink in wasm and rendered to a
canvas. Two demos are provided:

- `examples/index.html` — renders with **Canvas2D** (zero dependencies).
- `examples/canvaskit.html` — renders with **CanvasKit** (Skia compiled to wasm),
  using Skia's antialiased GPU `drawVertices`.

## What the scripts do

### `scripts/setup.mjs`
1. Shallow-clones Google Ink into `./ink` (skipped if present).
2. Pins Bazel 7 via `ink/.bazelversion`.
3. Appends an `emsdk` `bazel_dep` (+ a single-version abseil override) to
   `ink/MODULE.bazel` (idempotent, marked with comment fences).
4. Stages the `//wasm` Bazel package (`wasm-src/BUILD.bazel`,
   `wasm-src/bindings.cc`) into `ink/wasm/`.

Env: `INK_REF` (default `main`), `EMSDK_VERSION` (default `5.0.7`),
`BAZEL_VERSION` (default `7.4.1`).

### `scripts/build-wasm.mjs`
1. Runs a single `bazel build -c opt //wasm:ink_wasm //wasm:ink_wasm_umd //wasm:ink_wasm_legacy`
   inside `./ink`.
2. For each of the three variants, copies its emitted `.js`/`.wasm` from
   `bazel-bin` into its own `./wasm-build*` directory, normalizing the main
   glue file to `ink.js` (ESM) or `ink.cjs` (UMD/legacy — see "How it builds").
3. Copies the TypeScript declarations (`wasm-src/ink.d.ts`, identical across
   variants) alongside each as `ink.d.ts` (+ `ink.d.cts` for the `.cjs` ones).

Env: `BAZEL` (binary to use), `BAZEL_ARGS` (extra Bazel flags).

### `rslib build` (`rslib.config.ts`)
Three `lib` entries, one per bundle:
- **esm** — bundles `src/index.ts` + `src/renderer.ts` with the ESM glue into
  `dist/index.js` + `dist/renderer.js`, emits declaration files, and copies
  `wasm-build/ink.wasm` alongside.
- **umd** — same API (`src/index.umd.ts` + `src/renderer.ts`) bundled as UMD
  (`umdName: "InkWasm"`) into `dist/umd/`, with the UMD glue's `.wasm` copied
  alongside under its own name (`dist/umd/ink_umd.wasm`).
- **legacy** — `src/index.legacy.ts` (asm.js glue, no wasm) bundled as UMD
  into `dist/legacy/index.js`, downleveled to `es5`.

## How it builds

`wasm-src/BUILD.bazel` defines three `cc_binary` targets, all linking the same
core Ink libraries (`strokes`, `brush`, `geometry`, `color`, `types`) with the
Embind glue in `wasm-src/bindings.cc`, differing only in Emscripten flags:

| Target | Flags | Used by |
| --- | --- | --- |
| `ink` | `EXPORT_ES6=1`, `ENVIRONMENT=web,worker,node` | ESM bundle |
| `ink_umd` | no `EXPORT_ES6`, `ENVIRONMENT=web,worker` | UMD bundle |
| `ink_legacy` | same as `ink_umd`, plus `WASM=0` (asm.js) | legacy (no-wasm) bundle |

`EXPORT_ES6` controls whether the glue is an ES module (`import.meta.url`-based
wasm resolution — required for the ESM bundle) or a classic-script/CommonJS
module (`document.currentScript`-based resolution). `import.meta` is a syntax
error outside ES modules, so the UMD and legacy bundles **must** use the
non-ES6 glue — that's also why their glue is shipped as `ink.cjs`, not
`ink.js`: this package is `"type": "module"`, so a plain `.js` extension
would be parsed as ESM regardless of its actual CommonJS syntax. `WASM=0`
additionally makes Emscripten compile straight to asm.js instead of
WebAssembly, so `ink_legacy`'s glue is fully self-contained JS with no `.wasm`
output at all. The wasm bytecode itself is unaffected by `EXPORT_ES6`/
`ENVIRONMENT` (confirmed: `ink.wasm` and `ink_umd.wasm` are byte-identical in
size), so only the JS wrapper differs between the ESM and UMD builds.

The `wasm_cc_binary` rule from the `emsdk` module transitions each target —
and its entire transitive dependency graph — onto the Emscripten toolchain and
emits the `.js`/`.wasm`.

Only the **stroke-geometry core** is compiled into wasm: the input → brush →
stroke → mesh pipeline, which produces GPU-ready vertex/index buffers directly.
Google Ink's native C++ `rendering` module depends on Skia and is not compiled
here; instead, rendering is done on the JS side, where you can feed the mesh to
Canvas2D **or to Skia via CanvasKit** (see backends below).

## JS API

### Stroke engine

```js
import { createInk } from "ink-wasm";
const ink = await createInk();

ink.version(); // smoke test string

const mesh = ink.generateStrokeMesh(
  [ { x, y, t, pressure? }, ... ],  // input points; t = seconds since start
  "marker",                          // "marker" | "pressure_pen" | "highlighter"
  r, g, b, a,                        // color, 0..1
  size,                              // brush size
  epsilon,                           // simplification tolerance
);
// -> null on failure, else:
//    { vertices: Float32Array /*x,y*/, indices: Uint32Array, vertexCount, triangleCount }
```

`vertices`/`indices` map straight onto a WebGL `drawElements` call, a CanvasKit
`MakeVertices` call, or the Canvas2D triangle fill shown in the examples.

Full TypeScript declarations ship in `dist/`, so the import is fully typed.

### Rendering backends

Both backends implement the same interface, so you can swap renderers without
touching your stroke logic. They live behind the `ink-wasm/renderer` subpath too
(no wasm) for callers that bring their own geometry:

```js
import { createCanvas2dBackend, createCanvasKitBackend } from "ink-wasm/renderer";

// Canvas2D — zero dependencies:
const backend = createCanvas2dBackend(canvas);

// or CanvasKit (Skia/wasm) — pass an initialized CanvasKit instance:
//   const CanvasKit = await CanvasKitInit({ locateFile: ... });
const backend = createCanvasKitBackend(CanvasKit, canvas, { background: CanvasKit.WHITE });

const color = { r: 0.1, g: 0.4, b: 0.9, a: 0.85 };
backend.clear();
backend.drawMesh(mesh, color);   // mesh from ink.generateStrokeMesh(...)
backend.present();               // flush (no-op for Canvas2D)
```

`createCanvasKitBackend` takes an already-initialized CanvasKit so it stays
environment-agnostic; load CanvasKit from the `canvaskit-wasm` npm package or a
CDN (`examples/canvaskit.html` shows the CDN path).

## Layout

```
scripts/
  setup.mjs           # clone + patch the ink checkout
  build-wasm.mjs      # bazel build -> wasm-build*/ (glue + .wasm + .d.ts, x3)
  build.mjs           # setup (if needed) -> build-wasm -> rslib build
  common.mjs          # shared paths + helpers (incl. WASM_VARIANTS)
  clean.mjs
  test.mjs
rslib.config.ts       # 3 lib entries (esm/umd/legacy) -> dist/, dist/umd/, dist/legacy/
wasm-src/             # the Bazel package staged into ink/wasm
  BUILD.bazel         # 3 cc_binary targets: ink, ink_umd, ink_legacy
  bindings.cc         # Embind bindings over the Ink stroke pipeline
  ink.d.ts            # TypeScript declarations for the emitted glue (all 3 variants)
src/
  index.ts            # ESM public entry: createInk + renderers
  index.umd.ts        # same API, UMD entry (wasm-backed)
  index.legacy.ts     # same API, UMD entry (asm.js, no wasm)
  ink.ts              # typed wrapper around the ESM wasm module
  ink.umd.ts          # typed wrapper around the UMD wasm module
  ink.legacy.ts       # typed wrapper around the asm.js module
  ink-types.ts        # shared types (Ink, StrokeMesh, InitOptions, ...)
  renderer.ts         # Canvas2D + CanvasKit (Skia) rendering backends
  locate.ts           # ESM-only default wasm URL resolution (import.meta.url)
examples/
  node-test.mjs       # Node smoke test
  index.html          # browser drawing demo (Canvas2D)
  canvaskit.html      # browser drawing demo (CanvasKit / Skia)
  paint.html          # fuller paint app demo (Canvas2D)
ink/                  # cloned Google Ink (gitignored)
wasm-build/           # ESM Emscripten glue + .wasm + d.ts (gitignored)
wasm-build-umd/       # UMD Emscripten glue + .wasm + d.ts (gitignored)
wasm-build-legacy/    # asm.js Emscripten glue + d.ts, no .wasm (gitignored)
dist/                 # esm bundle: index.js + renderer.js + ink.wasm + d.ts
dist/umd/             # umd bundle: index.js + renderer.js + ink_umd.wasm
dist/legacy/          # legacy bundle: index.js only, no wasm
```
