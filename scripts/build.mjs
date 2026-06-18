// Full build: clone+patch ink (if needed) -> compile WebAssembly -> bundle JS.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INK_DIR, run } from "./common.mjs";

if (!existsSync(join(INK_DIR, "wasm", "BUILD.bazel"))) {
  run("node", ["scripts/setup.mjs"]);
}

run("node", ["scripts/build-wasm.mjs"]);

// Bundle the TypeScript wrappers (and the Emscripten glue they import) and
// emit declaration files. rslib resolves from node_modules / package.json bin.
run(process.platform === "win32" ? "npx.cmd" : "npx", ["rslib", "build"]);

console.log("\n✓ Build complete — see dist/.");
