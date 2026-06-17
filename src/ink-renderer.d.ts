// TypeScript declarations for the Google Ink rendering backends.
import type { StrokeMesh } from "../dist/ink.js";

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

/** Creates a dependency-free Canvas2D triangle-fill backend. */
export function createCanvas2dBackend(canvas: HTMLCanvasElement): InkBackend;

export interface CanvasKitBackendOptions {
  /** Clear color (CanvasKit Float32Array color); defaults to transparent. */
  background?: Float32Array;
  /** Pre-made CanvasKit surface; if omitted one is created for the canvas. */
  surface?: object;
  /** Antialias the fill; defaults to true. */
  antialias?: boolean;
}

/**
 * Creates a CanvasKit (Skia compiled to wasm) backend.
 *
 * @param CanvasKit An already-initialized CanvasKit instance.
 * @param canvas    The target canvas element.
 */
export function createCanvasKitBackend(
  CanvasKit: unknown,
  canvas: HTMLCanvasElement,
  opts?: CanvasKitBackendOptions,
): InkBackend;
