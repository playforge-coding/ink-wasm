// Legacy (no-wasm) twin of ink.ts, for browsers without WebAssembly support.
//
// Backed by ../wasm-build-legacy/ink.cjs: the same classic-script Emscripten
// glue as ink.umd.ts (.cjs for the same "type": "module" reason — see
// ink.umd.ts), but compiled to asm.js (WASM=0, see wasm-src/BUILD.bazel)
// instead of WebAssembly, so the whole engine ships as plain JS with no
// sibling .wasm to fetch. Slower and considerably larger than the wasm
// builds — use it only as a fallback for browsers that can't run wasm at all.
import createInkModule from "../wasm-build-legacy/ink.cjs";
import type { BrushName, Ink, StrokeInputPoint, StrokeMesh, InitOptions } from "./ink-types.js";

export type { BrushName, Ink, StrokeInputPoint, StrokeMesh, InitOptions };

/**
 * Instantiate the Ink module (asm.js, no WebAssembly) and return the typed
 * API. Loaded lazily; await the returned promise before calling any methods.
 * The returned object is reusable across many calls.
 */
export function createInk(options: InitOptions = {}): Promise<Ink> {
  return createInkModule({
    locateFile: options.locateFile,
  }) as Promise<Ink>;
}
