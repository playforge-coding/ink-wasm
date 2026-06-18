// Default resolver for the sibling .wasm file. Emscripten calls this with the
// bare wasm filename ("ink.wasm"); we resolve it relative to the bundle that
// contains this code via import.meta.url. Works in browsers, web workers and
// modern Node. For environments where that resolution fails, pass an explicit
// `wasmBinary` or `locateFile` to createInk().
export function defaultLocateFile(path: string): string {
  return new URL(path, import.meta.url).href;
}

export interface InitOptions {
  /**
   * Provide the WebAssembly bytes directly. Skips all URL resolution — useful
   * in Node or when you fetch the .wasm yourself (e.g. behind a CDN).
   */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /**
   * Customize how the .wasm file URL is resolved from its filename.
   * Defaults to resolving alongside the bundle.
   */
  locateFile?: (path: string, scriptDirectory: string) => string;
}
