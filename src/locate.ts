// Default resolver for the sibling .wasm file, used by the ESM build only.
// Emscripten calls this with the bare wasm filename ("ink.wasm"); we resolve
// it relative to the bundle that contains this code via import.meta.url.
// Works in browsers, web workers and modern Node. For environments where that
// resolution fails, pass an explicit `wasmBinary` or `locateFile` to
// createInk().
//
// `import.meta` is only valid inside an ES module, so this function — and
// this file — must never be imported (even transitively at the type level by
// value, not just `import type`) from the UMD or legacy entries (ink.umd.ts,
// ink.legacy.ts); those rely on Emscripten's own document.currentScript-based
// resolution instead. See wasm-src/BUILD.bazel for why those variants drop
// EXPORT_ES6.
export function defaultLocateFile(path: string): string {
  return new URL(path, import.meta.url).href;
}

export type { InitOptions } from "./ink-types.js";
