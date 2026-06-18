# ink-wasm

Build [Google Ink](https://github.com/google/ink) — Google's freehand stroke
generation library (the C++ engine behind Android's Jetpack Ink, and the same
family of tech used by Google Keep / Chrome Canvas) — for **WebAssembly**.

Google Ink is a Bazel 7+/bzlmod C++20 project with no built-in JS bindings. The
Node scripts in `scripts/` add an Emscripten toolchain to its Bazel build,
compile the core stroke pipeline to wasm, and expose it to JavaScript via Embind.
The TypeScript wrappers in `src/` are then bundled together with the Emscripten
glue by [Rslib](https://lib.rsbuild.dev/) into a pure-ESM package — with
TypeScript types and a choice of rendering backends (Canvas2D or CanvasKit/Skia).

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
pnpm setup        # clone Google Ink, register emsdk, stage the //wasm target
pnpm build:wasm   # bazel build -> wasm-build/ink.js + ink.wasm + ink.d.ts
pnpm build:js     # rslib bundle -> dist/index.js + dist/renderer.js + dist/ink.wasm
pnpm test         # run the pipeline in Node against the built bundle
```

`pnpm build` runs all three build steps in order (cloning + patching ink first
if needed). The first build downloads the Emscripten toolchain plus the
abseil/protobuf dependency tree, so it takes a while; subsequent builds are
incremental. `pnpm clean` removes `dist/`, `wasm-build/` and the `ink/` checkout.

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
1. Runs `bazel build -c opt //wasm:ink_wasm` inside `./ink`.
2. Copies the emitted `.js`/`.wasm` from `bazel-bin` into `./wasm-build`.
3. Copies the TypeScript declarations to `wasm-build/ink.d.ts`.

Env: `BAZEL` (binary to use), `BAZEL_ARGS` (extra Bazel flags).

### `rslib build` (`rslib.config.ts`)
Bundles the `src/` wrappers together with the Emscripten glue they import into
`dist/index.js` and `dist/renderer.js`, emits declaration files, and copies
`wasm-build/ink.wasm` to `dist/ink.wasm` alongside them.

## How it builds

`wasm-src/BUILD.bazel` defines a normal `cc_binary` (`//wasm:ink`) that links the
core Ink libraries (`strokes`, `brush`, `geometry`, `color`, `types`) with the
Embind glue in `wasm-src/bindings.cc`. The `wasm_cc_binary` rule from the
`emsdk` module transitions that target — and its entire transitive dependency
graph — onto the Emscripten toolchain and emits the `.js`/`.wasm`.

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
  build-wasm.mjs      # bazel build -> wasm-build/ (glue + .wasm + .d.ts)
  build.mjs           # setup (if needed) -> build-wasm -> rslib build
  common.mjs          # shared paths + helpers
  clean.mjs
  test.mjs
rslib.config.ts       # bundles src/ + glue into dist/, copies the .wasm
wasm-src/             # the Bazel package staged into ink/wasm
  BUILD.bazel
  bindings.cc         # Embind bindings over the Ink stroke pipeline
  ink.d.ts            # TypeScript declarations for the emitted glue
src/
  index.ts            # public entry: createInk + renderers
  ink.ts              # typed wrapper around the wasm module
  renderer.ts         # Canvas2D + CanvasKit (Skia) rendering backends
  locate.ts           # default wasm URL resolution + InitOptions
examples/
  node-test.mjs       # Node smoke test
  index.html          # browser drawing demo (Canvas2D)
  canvaskit.html      # browser drawing demo (CanvasKit / Skia)
  paint.html          # fuller paint app demo (Canvas2D)
ink/                  # cloned Google Ink (gitignored)
wasm-build/           # collected Emscripten glue + .wasm + d.ts (gitignored)
dist/                 # bundle: index.js + renderer.js + ink.wasm + d.ts (gitignored)
```
