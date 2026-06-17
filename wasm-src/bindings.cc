// WebAssembly / Embind bindings for Google Ink.
//
// Exposes the real Ink stroke-generation pipeline to JavaScript:
//   raw input points  ->  Brush + StrokeInputBatch  ->  Stroke  ->  mesh.
//
// The returned object contains flat typed arrays that map directly onto a
// WebGL / Canvas2D draw call:
//   { vertices: Float32Array (x,y pairs), indices: Uint32Array (triangles) }
//
// This file is compiled by Bazel via //wasm:ink (see wasm-src/BUILD.bazel),
// which is wrapped by an emscripten `wasm_cc_binary` target.

#include <array>
#include <cstdint>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "absl/status/statusor.h"
#include "ink/brush/brush.h"
#include "ink/brush/brush_family.h"
#include "ink/brush/stock_brushes.h"
#include "ink/color/color.h"
#include "ink/geometry/mesh.h"
#include "ink/geometry/partitioned_mesh.h"
#include "ink/geometry/point.h"
#include "ink/strokes/input/stroke_input.h"
#include "ink/strokes/input/stroke_input_batch.h"
#include "ink/strokes/stroke.h"
#include "ink/types/duration.h"

namespace {

using ::emscripten::typed_memory_view;
using ::emscripten::val;
using ::ink::Brush;
using ::ink::BrushFamily;
using ::ink::Color;
using ::ink::Duration32;
using ::ink::Mesh;
using ::ink::PartitionedMesh;
using ::ink::Point;
using ::ink::Stroke;
using ::ink::StrokeInput;
using ::ink::StrokeInputBatch;
namespace stock_brushes = ::ink::stock_brushes;

// Copies a std::vector into a fresh JS typed array. `typed_memory_view` only
// produces a *view* onto the wasm heap, which is invalidated once the vector is
// destroyed; constructing a new TypedArray from that view copies the bytes into
// the JS heap so the result outlives this function.
val ToFloat32Array(const std::vector<float>& v) {
  return val::global("Float32Array").new_(typed_memory_view(v.size(), v.data()));
}
val ToUint32Array(const std::vector<uint32_t>& v) {
  return val::global("Uint32Array").new_(typed_memory_view(v.size(), v.data()));
}

// Selects one of ink's built-in stock brush families by name.
BrushFamily StockFamily(const std::string& name) {
  if (name == "pressure_pen") return stock_brushes::PressurePen();
  if (name == "highlighter") return stock_brushes::Highlighter();
  return stock_brushes::Marker();  // default
}

// Generates a stroke mesh from a list of JS input points.
//
// `js_points` is an array of { x, y, t, pressure? } objects (t = seconds since
// the start of the stroke). Returns null if the brush or input batch is
// rejected by ink (e.g. non-monotonic time, bad parameters).
val GenerateStrokeMesh(const val& js_points, const std::string& brush_name,
                       float r, float g, float b, float a, float size,
                       float epsilon) {
  // 1. Build the brush.
  BrushFamily family = StockFamily(brush_name);
  Color color = Color::FromFloat(r, g, b, a);
  absl::StatusOr<Brush> brush = Brush::Create(family, color, size, epsilon);
  if (!brush.ok()) return val::null();

  // 2. Marshal the JS input points into ink StrokeInputs.
  const unsigned n = js_points["length"].as<unsigned>();
  std::vector<StrokeInput> inputs;
  inputs.reserve(n);
  for (unsigned i = 0; i < n; ++i) {
    const val p = js_points[i];
    StrokeInput in;
    in.tool_type = StrokeInput::ToolType::kStylus;
    in.position = Point{p["x"].as<float>(), p["y"].as<float>()};
    in.elapsed_time = Duration32::Seconds(p["t"].as<float>());
    if (p.hasOwnProperty("pressure")) {
      in.pressure = p["pressure"].as<float>();
    }
    inputs.push_back(in);
  }
  absl::StatusOr<StrokeInputBatch> batch = StrokeInputBatch::Create(inputs);
  if (!batch.ok()) return val::null();

  // 3. Generate the stroke geometry.
  Stroke stroke(*brush, *batch);
  const PartitionedMesh& shape = stroke.GetShape();

  // 4. Flatten every mesh in the first render group into (x,y) vertex pairs and
  //    triangle indices, re-basing indices as meshes are concatenated.
  std::vector<float> vertices;
  std::vector<uint32_t> indices;
  if (shape.RenderGroupCount() > 0) {
    uint32_t base = 0;
    for (const Mesh& mesh : shape.RenderGroupMeshes(0)) {
      const uint32_t vcount = mesh.VertexCount();
      vertices.reserve(vertices.size() + vcount * 2);
      for (uint32_t v = 0; v < vcount; ++v) {
        const Point pt = mesh.VertexPosition(v);
        vertices.push_back(pt.x);
        vertices.push_back(pt.y);
      }
      const uint32_t tcount = mesh.TriangleCount();
      indices.reserve(indices.size() + tcount * 3);
      for (uint32_t t = 0; t < tcount; ++t) {
        const std::array<uint32_t, 3> tri = mesh.TriangleIndices(t);
        indices.push_back(base + tri[0]);
        indices.push_back(base + tri[1]);
        indices.push_back(base + tri[2]);
      }
      base += vcount;
    }
  }

  val result = val::object();
  result.set("vertices", ToFloat32Array(vertices));
  result.set("indices", ToUint32Array(indices));
  result.set("vertexCount", val(vertices.size() / 2));
  result.set("triangleCount", val(indices.size() / 3));
  return result;
}

// Simple smoke-test entry point used to confirm the module loaded and the ink
// pipeline links and runs.
std::string Version() { return "Google Ink (wasm) bindings - pipeline OK"; }

}  // namespace

EMSCRIPTEN_BINDINGS(ink_module) {
  emscripten::function("version", &Version);
  emscripten::function("generateStrokeMesh", &GenerateStrokeMesh);
}
