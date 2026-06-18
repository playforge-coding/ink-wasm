// build-wasm.mjs — compile Google Ink to WebAssembly and collect the glue.
//
// Runs `bazel build //wasm:ink_wasm` inside the ink checkout (using the
// emscripten toolchain registered by setup.mjs), then copies the emitted
// .js/.wasm into ./wasm-build, where Rslib picks them up (rslib.config.ts).
//
// Config via env vars:
//   BAZEL        bazel binary to use (default: bazelisk if present, else bazel)
//   BAZEL_ARGS   extra args appended to the build (e.g. "--sandbox_debug")

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { INK_DIR, WASM_SRC, WASM_OUT, BAZEL_TARGET, pickBazel } from "./common.mjs";

function ensureSetup() {
  if (!existsSync(join(INK_DIR, "wasm", "BUILD.bazel"))) {
    throw new Error("ink/wasm not staged. Run `node scripts/setup.mjs` first.");
  }
}

// The compilation mode determines the output path (k8-opt vs k8-fastbuild), so
// it must be applied to both `build` and `info bazel-bin`.
const COMPILATION_MODE = ["-c", "opt"];

function build(bazel) {
  const extra = process.env.BAZEL_ARGS ? process.env.BAZEL_ARGS.split(" ") : [];
  const args = ["build", ...COMPILATION_MODE, BAZEL_TARGET, ...extra];
  console.log(`$ ${bazel} ${args.join(" ")}  (cwd: ${INK_DIR})`);
  execFileSync(bazel, args, { cwd: INK_DIR, stdio: "inherit" });
}

// `bazel info bazel-bin` gives the real (symlinked) output root. It reports a
// config-specific path, so it MUST be passed the same `-c opt` as the build or
// it points at the wrong (empty) k8-fastbuild directory.
function bazelBin(bazel) {
  return execFileSync(bazel, ["info", "bazel-bin", ...COMPILATION_MODE], {
    cwd: INK_DIR,
  })
    .toString()
    .trim();
}

function collect(bazel) {
  const outDir = join(bazelBin(bazel), "wasm", "ink_wasm");
  if (!existsSync(outDir)) {
    throw new Error(`Expected output dir not found: ${outDir}`);
  }
  rmSync(WASM_OUT, { recursive: true, force: true });
  mkdirSync(WASM_OUT, { recursive: true });

  let copied = 0;
  for (const name of readdirSync(outDir)) {
    if (!/\.(js|wasm|worker\.js)$/.test(name)) continue;
    const src = join(outDir, name);
    // wasm_cc_binary always emits the full set of artifacts, several of them
    // empty placeholders (e.g. ink.wasm.debug.wasm when not building debug).
    // Skip zero-byte files so wasm-build only holds the real loader + wasm.
    if (statSync(src).size === 0) continue;
    const dest = join(WASM_OUT, name);
    copyFileSync(src, dest);
    const kb = (statSync(dest).size / 1024).toFixed(1);
    console.log(`  ${name.padEnd(16)} ${kb.padStart(8)} KB`);
    copied++;
  }
  if (copied === 0) throw new Error(`No .js/.wasm artifacts in ${outDir}`);

  // Ship the TypeScript declarations for the emitted loader next to it, so the
  // wrappers in src/ type the `import createInkModule from "../wasm-build/ink.js"`.
  copyFileSync(join(WASM_SRC, "ink.d.ts"), join(WASM_OUT, "ink.d.ts"));
  console.log(`  ${"ink.d.ts".padEnd(16)} ${"(types)".padStart(8)}`);

  console.log(`\n✓ Wrote glue + wasm to ${WASM_OUT}`);
}

ensureSetup();
const bazel = pickBazel();
build(bazel);
collect(bazel);
console.log("\nNext: rslib build  (or `pnpm build:js`)");
