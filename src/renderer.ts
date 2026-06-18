// Rendering backends for Google Ink stroke meshes.
//
// `createInk().generateStrokeMesh` (from "./ink.js") returns GPU-ready
// geometry: { vertices: Float32Array /* x,y pairs */, indices: Uint32Array }.
//
// This module turns that geometry into pixels. Every backend implements the
// same small InkBackend interface so callers can swap renderers without
// touching their input/stroke logic. Two backends are provided:
//   - createCanvas2dBackend  — fills triangles on a 2D canvas (zero deps).
//   - createCanvasKitBackend — draws via CanvasKit (Skia compiled to wasm),
//     using Skia's antialiased GPU `drawVertices`, the same renderer Google
//     Ink itself targets natively.
import type { StrokeMesh } from "./ink.js";

/** RGBA color, each component in 0..1. */
export interface InkColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * A rendering backend. Implementations turn a {@link StrokeMesh} into pixels;
 * the interface is identical across Canvas2D and CanvasKit so callers can swap
 * renderers freely.
 */
export interface InkBackend {
  /** Erase the current frame. */
  clear(): void;
  /** Draw a stroke mesh in the given color. */
  drawMesh(mesh: StrokeMesh, color: InkColor): void;
  /** Flush pending GPU work to the canvas (no-op for Canvas2D). */
  present(): void;
  /** Release any native resources held by the backend. */
  dispose(): void;
}

/**
 * Canvas2D backend: fills each mesh triangle as a path. Simple and dependency
 * free, but unantialiased at triangle seams.
 */
export function createCanvas2dBackend(canvas: HTMLCanvasElement): InkBackend {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas2D: getContext('2d') returned null");

  return {
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    drawMesh(mesh, { r, g, b, a }) {
      ctx.fillStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${
        (b * 255) | 0
      },${a})`;
      const v = mesh.vertices;
      const idx = mesh.indices;
      ctx.beginPath();
      for (let i = 0; i < idx.length; i += 3) {
        const p = idx[i] * 2;
        const q = idx[i + 1] * 2;
        const s = idx[i + 2] * 2;
        ctx.moveTo(v[p], v[p + 1]);
        ctx.lineTo(v[q], v[q + 1]);
        ctx.lineTo(v[s], v[s + 1]);
        ctx.closePath();
      }
      ctx.fill();
    },
    present() {},
    dispose() {},
  };
}

export interface CanvasKitBackendOptions {
  /** Clear color (CanvasKit Float32Array color); defaults to transparent. */
  background?: Float32Array;
  /** Pre-made CanvasKit surface; if omitted one is created for the canvas. */
  surface?: { getCanvas(): unknown; flush(): void; delete(): void };
  /** Antialias the fill; defaults to true. */
  antialias?: boolean;
}

/**
 * CanvasKit (Skia-wasm) backend.
 *
 * Pass an already-initialized CanvasKit instance — load it however suits your
 * environment, e.g. in the browser:
 *
 *   <script src="https://unpkg.com/canvaskit-wasm@0.39.1/bin/canvaskit.js"></script>
 *   const CanvasKit = await CanvasKitInit({ locateFile: f =>
 *     `https://unpkg.com/canvaskit-wasm@0.39.1/bin/${f}` });
 *
 * or with the npm package: `import CanvasKitInit from "canvaskit-wasm"`.
 *
 * @param CanvasKit An already-initialized CanvasKit instance.
 * @param canvas    The target canvas element.
 */
export function createCanvasKitBackend(
  // CanvasKit's own types are optional (npm: canvaskit-wasm); keep this loose
  // so consumers aren't forced to install them.
  CanvasKit: any,
  canvas: HTMLCanvasElement,
  opts: CanvasKitBackendOptions = {},
): InkBackend {
  // Prefer a GPU (WebGL) surface; fall back to the software rasterizer.
  const surface =
    opts.surface ??
    CanvasKit.MakeWebGLCanvasSurface(canvas) ??
    CanvasKit.MakeSWCanvasSurface(canvas);
  if (!surface) {
    throw new Error("CanvasKit: could not create a drawing surface for canvas");
  }

  const skCanvas = surface.getCanvas();
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(opts.antialias ?? true);
  paint.setStyle(CanvasKit.PaintStyle.Fill);

  const background = opts.background ?? CanvasKit.TRANSPARENT;

  return {
    clear() {
      skCanvas.clear(background);
    },
    drawMesh(mesh, { r, g, b, a }) {
      if (mesh.indices.length === 0) return;
      // Skia stores vertex indices as 16-bit, so a single mesh is capped at
      // 65535 vertices. Stroke meshes are far smaller, but guard anyway.
      if (mesh.vertexCount > 65535) {
        throw new Error(
          `CanvasKit: mesh has ${mesh.vertexCount} vertices, exceeds Skia's ` +
            `16-bit index limit (65535)`,
        );
      }
      const vertices = CanvasKit.MakeVertices(
        CanvasKit.VertexMode.Triangles,
        mesh.vertices, // flattened x,y positions
        null, // texture coordinates
        null, // per-vertex colors
        Array.from(mesh.indices), // triangle indices (coerced to 16-bit)
        false, // not volatile
      );
      paint.setColor(CanvasKit.Color4f(r, g, b, a));
      skCanvas.drawVertices(vertices, CanvasKit.BlendMode.SrcOver, paint);
      vertices.delete();
    },
    present() {
      surface.flush();
    },
    dispose() {
      paint.delete();
      // The caller owns `opts.surface`; only delete one we created.
      if (!opts.surface) surface.delete();
    },
  };
}
