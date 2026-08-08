// Remove all generated artifacts: the bundle, the collected glue, and every
// change setup.mjs/build-wasm.mjs made inside the ink submodule. Leaves source
// (src/, wasm-src/, scripts/) untouched.
import { rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, join } from "node:path";
import { ROOT, INK_DIR, WASM_VARIANTS } from "./common.mjs";

for (const dir of [resolve(ROOT, "dist"), ...WASM_VARIANTS.map((v) => v.outDir)]) {
  rmSync(dir, { recursive: true, force: true });
  console.log(`  removed ${dir}`);
}

// ink is a git submodule, so it must be reset rather than deleted — removing
// the directory would leave the submodule broken until a `git submodule update`.
// `checkout` reverts the MODULE.bazel patch and the lockfile Bazel rewrote;
// `clean -xfd` drops the staged //wasm package, .bazelversion and the bazel-*
// convenience symlinks. Bazel's own output base lives outside the tree and is
// left alone (`bazel clean --expunge` inside ink/ if you want that too).
if (existsSync(join(INK_DIR, ".git"))) {
  for (const args of [
    ["-C", INK_DIR, "checkout", "--", "."],
    ["-C", INK_DIR, "clean", "-xfd"],
  ]) {
    const res = spawnSync("git", args, { stdio: "inherit" });
    if (res.status !== 0) console.warn(`⚠ git ${args.slice(2).join(" ")} failed in ink/`);
  }
  console.log(`  reset ${INK_DIR} (submodule)`);
} else {
  rmSync(INK_DIR, { recursive: true, force: true });
  console.log(`  removed ${INK_DIR}`);
}
console.log("✓ Clean.");
