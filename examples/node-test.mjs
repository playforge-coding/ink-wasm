// Loads the compiled ink wasm module in Node and runs the real stroke pipeline.
//   node examples/node-test.mjs
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dist = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "ink.mjs",
);
const { default: createInkModule } = await import(dist);

const ink = await createInkModule();
console.log(ink.version());

// A short curved stroke: x, y, t (seconds), optional pressure.
const points = [
  { x: 10, y: 10, t: 0.0, pressure: 0.2 },
  { x: 30, y: 40, t: 0.02, pressure: 0.5 },
  { x: 60, y: 50, t: 0.04, pressure: 0.8 },
  { x: 90, y: 30, t: 0.06, pressure: 0.6 },
  { x: 120, y: 60, t: 0.08, pressure: 0.3 },
];

const mesh = ink.generateStrokeMesh(
  points,
  "marker", // brush family: marker | pressure_pen | highlighter
  0.1,
  0.4,
  0.9,
  1.0, // rgba
  4.0, // brush size
  0.1, // epsilon (simplification tolerance)
);

if (!mesh) {
  console.error("Stroke generation failed (brush or input rejected).");
  process.exit(1);
}

console.log(`vertices: ${mesh.vertexCount}, triangles: ${mesh.triangleCount}`);
console.log("first vertex:", mesh.vertices[0], mesh.vertices[1]);
console.log("first triangle indices:", mesh.indices.slice(0, 3));
