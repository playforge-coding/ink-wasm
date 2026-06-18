// Remove all generated artifacts: the bundle, the collected glue, and the
// cloned ink checkout. Leaves source (src/, wasm-src/, scripts/) untouched.
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, INK_DIR, WASM_OUT } from "./common.mjs";

for (const dir of [resolve(ROOT, "dist"), WASM_OUT, INK_DIR]) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`  removed ${dir}`);
}
console.log("✓ Clean.");
