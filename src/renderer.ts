// Rendering backends for Google Ink stroke meshes.
//
// `createInk().generateStrokeMesh` (from "./ink.js") returns GPU-ready
// geometry: { vertices: Float32Array /* x,y pairs */, indices: Uint32Array }.
//
// This module turns that geometry into pixels. Every backend implements the
// same small InkBackend interface so callers can swap renderers without
// touching their input/stroke logic. Three backends are provided:
//   - createCanvas2dBackend  — fills triangles on a 2D canvas (zero deps).
//   - createWebglBackend     — uploads the mesh straight to the GPU and draws
//     it with `drawElements` (zero deps, WebGL2 or WebGL1).
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
 * the interface is identical across Canvas2D, WebGL and CanvasKit so callers
 * can swap renderers freely.
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
      ctx.fillStyle = `rgba(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0},${a})`;
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

export interface WebglBackendOptions {
  /** Clear color; defaults to transparent. */
  background?: InkColor;
  /**
   * Draw into an existing context instead of creating one. Must belong to
   * `canvas`. The caller keeps ownership: `dispose()` frees the backend's own
   * program and buffers but leaves the context alive.
   */
  gl?: WebGLRenderingContext | WebGL2RenderingContext;
  /** Multisample the drawing buffer; defaults to true. Ignored if `gl` is given. */
  antialias?: boolean;
  /**
   * Extra `getContext` attributes, merged over the defaults
   * (`alpha`, `antialias`, `premultipliedAlpha` and `preserveDrawingBuffer`
   * are all on). Ignored if `gl` is given.
   */
  contextAttributes?: WebGLContextAttributes;
}

// Mesh coordinates are canvas pixels with y pointing down; clip space is
// [-1, 1] with y pointing up. GLSL ES 1.00 so the same source compiles on both
// WebGL1 and WebGL2.
const WEBGL_VERTEX_SHADER = `
attribute vec2 a_position;
uniform vec2 u_resolution;
void main() {
  vec2 clip = a_position / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// Premultiplied output, to match the canvas's premultiplied compositing and the
// ONE / ONE_MINUS_SRC_ALPHA blend the backend sets up.
const WEBGL_FRAGMENT_SHADER = `
precision mediump float;
uniform vec4 u_color;
void main() {
  gl_FragColor = vec4(u_color.rgb * u_color.a, u_color.a);
}`;

/** Everything the backend allocates on the context; rebuilt after context loss. */
interface WebglResources {
  program: WebGLProgram;
  shaders: WebGLShader[];
  positionBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  positionLoc: number;
  resolutionLoc: WebGLUniformLocation | null;
  colorLoc: WebGLUniformLocation | null;
  /** Allocated size of each buffer, in bytes; grown on demand. */
  vertexCapacity: number;
  indexCapacity: number;
}

/**
 * WebGL backend: uploads the mesh's vertex/index arrays to the GPU and draws
 * them with a single `drawElements` call per stroke. No dependencies (unlike
 * CanvasKit) and far faster than Canvas2D on large meshes, but the triangles
 * are drawn without antialiasing beyond whatever MSAA the context provides.
 *
 * The mesh is consumed in canvas-pixel coordinates, exactly like the other
 * backends — the shader maps them to clip space using the drawing buffer size,
 * so resizing the canvas needs no extra call.
 *
 * @param canvas The target canvas element.
 */
export function createWebglBackend(
  canvas: HTMLCanvasElement,
  opts: WebglBackendOptions = {},
): InkBackend {
  const attributes: WebGLContextAttributes = {
    alpha: true,
    antialias: opts.antialias ?? true,
    premultipliedAlpha: true,
    // Canvas2D-like semantics: the drawing survives compositing, so callers can
    // draw incrementally and `canvas.toDataURL()` captures what's on screen.
    preserveDrawingBuffer: true,
    ...opts.contextAttributes,
  };

  const context =
    opts.gl ?? canvas.getContext("webgl2", attributes) ?? canvas.getContext("webgl", attributes);
  if (!context) throw new Error("WebGL: getContext('webgl') returned null");
  // Re-bind through a non-nullable declaration: the helpers and the returned
  // methods below all close over it, and TS doesn't carry a narrowing that far.
  const gl: WebGLRenderingContext | WebGL2RenderingContext = context;

  // WebGL2 indexes with 32-bit integers natively; WebGL1 needs an extension.
  // Without either we narrow to 16-bit indices, which stroke meshes fit into
  // comfortably (see the vertex-count guard in drawMesh).
  const uint32Indices =
    typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext
      ? true
      : !!gl.getExtension("OES_element_index_uint");
  // Scratch buffer for the 16-bit fallback, grown as needed.
  let narrowIndices: Uint16Array | null = null;

  const bg = opts.background ?? { r: 0, g: 0, b: 0, a: 0 };

  function compile(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("WebGL: could not create shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`WebGL: shader compilation failed: ${log}`);
    }
    return shader;
  }

  function createResources(): WebglResources {
    const vs = compile(gl.VERTEX_SHADER, WEBGL_VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, WEBGL_FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error("WebGL: could not create program");
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      throw new Error(`WebGL: program link failed: ${log}`);
    }

    const positionBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!positionBuffer || !indexBuffer) {
      throw new Error("WebGL: could not create buffers");
    }

    return {
      program,
      shaders: [vs, fs],
      positionBuffer,
      indexBuffer,
      positionLoc: gl.getAttribLocation(program, "a_position"),
      resolutionLoc: gl.getUniformLocation(program, "u_resolution"),
      colorLoc: gl.getUniformLocation(program, "u_color"),
      vertexCapacity: 0,
      indexCapacity: 0,
    };
  }

  let res: WebglResources | null = createResources();

  // A lost context invalidates every object above. Cancelling the event is what
  // lets the browser hand us a fresh context, at which point we rebuild them;
  // in between, draw calls are dropped rather than throwing.
  const onContextLost = (e: Event) => {
    e.preventDefault();
    res = null;
    narrowIndices = null;
  };
  const onContextRestored = () => {
    res = createResources();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  /** Re-upload `data`, growing the buffer's allocation only when it must. */
  function upload(
    target: number,
    buffer: WebGLBuffer,
    data: ArrayBufferView,
    capacity: number,
  ): number {
    gl.bindBuffer(target, buffer);
    if (data.byteLength > capacity) {
      gl.bufferData(target, data, gl.DYNAMIC_DRAW);
      return data.byteLength;
    }
    gl.bufferSubData(target, 0, data);
    return capacity;
  }

  return {
    clear() {
      if (!res) return;
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      // The drawing buffer is premultiplied, so premultiply the clear color too.
      gl.clearColor(bg.r * bg.a, bg.g * bg.a, bg.b * bg.a, bg.a);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    drawMesh(mesh, { r, g, b, a }) {
      if (!res || mesh.indices.length === 0) return;

      let indices: ArrayBufferView = mesh.indices;
      let indexType: GLenum = gl.UNSIGNED_INT;
      if (!uint32Indices) {
        if (mesh.vertexCount > 65535) {
          throw new Error(
            `WebGL: mesh has ${mesh.vertexCount} vertices, exceeds this ` +
              `context's 16-bit index limit (65535) — WebGL2 or the ` +
              `OES_element_index_uint extension is required for more`,
          );
        }
        if (!narrowIndices || narrowIndices.length < mesh.indices.length) {
          narrowIndices = new Uint16Array(mesh.indices.length);
        }
        narrowIndices.set(mesh.indices);
        // `set` leaves any tail from a previous, longer mesh in place; the draw
        // call below only reads the first mesh.indices.length entries.
        indices = narrowIndices.subarray(0, mesh.indices.length);
        indexType = gl.UNSIGNED_SHORT;
      }

      res.vertexCapacity = upload(
        gl.ARRAY_BUFFER,
        res.positionBuffer,
        mesh.vertices,
        res.vertexCapacity,
      );
      res.indexCapacity = upload(
        gl.ELEMENT_ARRAY_BUFFER,
        res.indexBuffer,
        indices,
        res.indexCapacity,
      );

      // Set the pipeline state per draw rather than once up front: the context
      // may be shared with other rendering code that leaves it however it likes.
      gl.useProgram(res.program);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(res.resolutionLoc, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform4f(res.colorLoc, r, g, b, a);

      gl.enableVertexAttribArray(res.positionLoc);
      gl.vertexAttribPointer(res.positionLoc, 2, gl.FLOAT, false, 0, 0);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, indexType, 0);
    },
    present() {
      if (res) gl.flush();
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (!res) return;
      gl.deleteBuffer(res.positionBuffer);
      gl.deleteBuffer(res.indexBuffer);
      for (const shader of res.shaders) gl.deleteShader(shader);
      gl.deleteProgram(res.program);
      res = null;
      narrowIndices = null;
    },
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
