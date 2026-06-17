// TypeScript declarations for the Google Ink WebAssembly module.
//
// This describes the Embind surface defined in wasm-src/bindings.cc. The build
// (build.js) ships it alongside the emitted loader as dist/ink.d.ts, so editors
// type `import createInkModule from "./dist/ink.mjs"` against the real API.

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
export interface InkModule {
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

/** Options forwarded to the underlying Emscripten module factory. */
export interface InkModuleOptions {
  locateFile?: (path: string, prefix: string) => string;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
  [key: string]: unknown;
}

/**
 * Instantiates the Ink WebAssembly module. The wasm is fetched/loaded lazily;
 * await the returned promise before calling any methods.
 */
export default function createInkModule(
  options?: InkModuleOptions,
): Promise<InkModule>;
