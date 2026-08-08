// Full build: clone+patch ink (if needed) -> compile WebAssembly -> bundle JS.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { INK_DIR, run } from "./common.mjs";

if (!existsSync(join(INK_DIR, "wasm", "BUILD.bazel"))) {
  run("node", ["scripts/setup.mjs"]);
}

run("node", ["scripts/build-wasm.mjs"]);

// Bundle the TypeScript wrappers (and the Emscripten glue they import) and
// emit declaration files. `vp` (Vite+) resolves from node_modules/.bin, so
// this works whether or not the global CLI is installed. The asm.js fallback
// is bundled separately — see scripts/build-legacy.mjs for why.
run(process.platform === "win32" ? "npx.cmd" : "npx", ["vp", "pack"]);
run("node", ["scripts/build-legacy.mjs"]);

console.log("\n✓ Build complete — see dist/.");
