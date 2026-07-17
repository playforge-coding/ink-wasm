// Types shared by every createInk() variant (ESM/UMD/legacy). Pure types, no
// runtime code — importing this via `import type` never pulls the wasm glue
// or import.meta.url usage into a bundle, so it's safe for the UMD/legacy
// entries too (see ink.ts, ink.umd.ts, ink.legacy.ts).

/** A built-in stock brush family. */
export type BrushName = "marker" | "pressure_pen" | "highlighter";

/**
 * A generated stroke mesh. `vertices` holds interleaved (x, y) pairs, so the
 * point at index `i` is `(vertices[i*2], vertices[i*2+1])`; `indices` lists
 * triangle corners into that vertex array. Both map straight onto a WebGL
 * `drawElements` call or a CanvasKit `MakeVertices` call.
 */
export interface StrokeMesh {
  /** Interleaved x,y vertex positions. Length === vertexCount * 2. */
  vertices: Float32Array;
  /** Triangle indices into `vertices`. Length === triangleCount * 3. */
  indices: Uint32Array;
  /** Number of vertices (vertices.length / 2). */
  vertexCount: number;
  /** Number of triangles (indices.length / 3). */
  triangleCount: number;
}

/** A single raw input sample. `t` is seconds since the start of the stroke. */
export interface StrokeInputPoint {
  x: number;
  y: number;
  t: number;
  /** Optional stylus pressure, 0..1. */
  pressure?: number;
}

/** The instantiated Ink wasm module. */
export interface Ink {
  /** Smoke-test string confirming the module loaded and the pipeline links. */
  version(): string;

  /**
   * Runs the full ink pipeline (input → brush → stroke → mesh) and returns
   * GPU-ready geometry, or `null` if ink rejected the brush or input batch
   * (e.g. non-monotonic time or invalid parameters).
   *
   * @param points  Input samples; `t` is seconds since the start of the stroke.
   * @param brush   One of the built-in stock brush families.
   * @param r,g,b,a Brush color components, 0..1.
   * @param size    Brush size.
   * @param epsilon Simplification tolerance.
   */
  generateStrokeMesh(
    points: StrokeInputPoint[],
    brush: BrushName,
    r: number,
    g: number,
    b: number,
    a: number,
    size: number,
    epsilon: number,
  ): StrokeMesh | null;
}

export interface InitOptions {
  /**
   * Provide the WebAssembly bytes directly. Skips all URL resolution — useful
   * in Node or when you fetch the .wasm yourself (e.g. behind a CDN). Not
   * applicable to the wasm-free legacy (asm.js) build.
   */
  wasmBinary?: ArrayBuffer | Uint8Array;
  /**
   * Customize how the .wasm file URL is resolved from its filename. Defaults
   * to resolving alongside the bundle.
   */
  locateFile?: (path: string, scriptDirectory: string) => string;
}
