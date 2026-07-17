// UMD twin of ink.ts — same typed wrapper around the Google Ink module, but
// backed by the classic-script Emscripten glue (../wasm-build-umd/ink.cjs)
// instead of the ES-module one. It's .cjs (not .js) because our package.json
// is "type": "module": a plain .js would be parsed as ESM regardless of its
// actual CommonJS syntax (`module.exports = ...`), which this glue uses.
//
// That glue is compiled without EXPORT_ES6 (see wasm-src/BUILD.bazel), so it
// never references import.meta — which is invalid outside ES modules and
// would break the UMD bundle. It resolves the sibling .wasm itself via
// `document.currentScript.src`, which is reliable for classic (non-module)
// <script> tags and CommonJS `require()`, so no custom `locateFile` default
// is needed here (unlike ink.ts). Pass an explicit `locateFile` or
// `wasmBinary` if that detection doesn't fit your environment.
import createInkModule from "../wasm-build-umd/ink.cjs";
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
    locateFile: options.locateFile,
  }) as Promise<Ink>;
}
