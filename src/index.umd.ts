// UMD entry point (see vite.config.ts). Same public API as index.ts, wired
// to the classic-script wasm build (src/ink.umd.ts) so this can be loaded via
// a plain <script> tag, CommonJS `require()`, or AMD — not just ESM.
export { createInk } from "./ink.umd.js";
export type { Ink, StrokeMesh, StrokeInputPoint, BrushName, InitOptions } from "./ink-types.js";

export { createCanvas2dBackend, createWebglBackend, createCanvasKitBackend } from "./renderer.js";
export type {
  InkBackend,
  InkColor,
  WebglBackendOptions,
  CanvasKitBackendOptions,
} from "./renderer.js";
