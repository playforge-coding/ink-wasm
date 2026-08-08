// Legacy (no-wasm) entry point (see rslib.config.ts), for browsers without
// WebAssembly support. Same public API as index.ts, backed by the asm.js
// build (src/ink.legacy.ts). UMD format, like index.umd.ts.
export { createInk } from "./ink.legacy.js";
export type { Ink, StrokeMesh, StrokeInputPoint, BrushName, InitOptions } from "./ink-types.js";

export { createCanvas2dBackend, createWebglBackend, createCanvasKitBackend } from "./renderer.js";
export type { InkBackend, InkColor, WebglBackendOptions, CanvasKitBackendOptions } from "./renderer.js";
