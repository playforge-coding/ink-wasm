// Typed, ergonomic wrapper around the Google Ink WebAssembly module.
//
// The Emscripten glue (../wasm-build/ink.js) and its .wasm are bundled in by
// Rslib; the public API surface is declared here so the emitted declarations
// stay self-contained (they must not reference ../wasm-build, which ships only
// inside the bundle).
import createInkModule from "../wasm-build/ink.js";
import { defaultLocateFile } from "./locate.js";
import type { BrushName, Ink, StrokeInputPoint, StrokeMesh, InitOptions } from "./ink-types.js";

export type { BrushName, Ink, StrokeInputPoint, StrokeMesh, InitOptions };

/**
 * Instantiate the Ink WebAssembly module and return the typed API. The wasm is
 * loaded lazily; await the returned promise before calling any methods. The
 * returned object is reusable across many calls.
 */
export function createInk(options: InitOptions = {}): Promise<Ink> {
  return createInkModule({
    wasmBinary: options.wasmBinary,
    locateFile: options.locateFile ?? defaultLocateFile,
  }) as Promise<Ink>;
}
