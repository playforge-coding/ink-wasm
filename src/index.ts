// ink-wasm — Google Ink (freehand stroke generation) compiled to WebAssembly,
// with TypeScript types and Canvas2D / CanvasKit (Skia) rendering backends.
//
// Import the stroke engine and a renderer from the root, or pull in only the
// renderers (no wasm) via the "ink-wasm/renderer" subpath.
export { createInk } from "./ink.js";
export type {
  Ink,
  StrokeMesh,
  StrokeInputPoint,
  BrushName,
  InitOptions,
} from "./ink.js";

export { createCanvas2dBackend, createCanvasKitBackend } from "./renderer.js";
export type {
  InkBackend,
  InkColor,
  CanvasKitBackendOptions,
} from "./renderer.js";
