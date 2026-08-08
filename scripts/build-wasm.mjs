// build-wasm.mjs — compile Google Ink to WebAssembly (+ asm.js) and collect
// the glue.
//
// Runs a single `bazel build` for all three wasm_cc_binary targets inside the
// ink checkout (using the emscripten toolchain registered by setup.mjs), then
// copies each variant's emitted .js/.wasm into its own wasm-build* directory,
// where Rslib picks them up (rslib.config.ts). See WASM_VARIANTS in
// common.mjs and wasm-src/BUILD.bazel for what each variant is for.
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
import { INK_DIR, WASM_SRC, WASM_VARIANTS, pickBazel } from "./common.mjs";

function ensureSetup() {
  if (!existsSync(join(INK_DIR, "wasm", "BUILD.bazel"))) {
    throw new Error("ink/wasm not staged. Run `node scripts/setup.mjs` first.");
  }
}

// The compilation mode determines the output path (k8-opt vs k8-fastbuild), so
// it must be applied to both `build` and `info bazel-bin`.
const COMPILATION_MODE = ["-c", "opt"];

// ink's own .bazelrc pins `--lockfile_mode=error`, which is right for upstream
// but not for us: setup.mjs adds emsdk (plus an abseil override) to
// MODULE.bazel, so the checked-in MODULE.bazel.lock is missing those entries by
// construction and every build would fail the up-to-date check. `update` lets
// Bazel extend the lockfile in place inside the submodule.
const LOCKFILE_MODE = ["--lockfile_mode=update"];

function build(bazel) {
  const extra = process.env.BAZEL_ARGS ? process.env.BAZEL_ARGS.split(" ") : [];
  const targets = WASM_VARIANTS.map((v) => v.bazelTarget);
  const args = ["build", ...COMPILATION_MODE, ...LOCKFILE_MODE, ...targets, ...extra];
  console.log(`$ ${bazel} ${args.join(" ")}  (cwd: ${INK_DIR})`);
  execFileSync(bazel, args, { cwd: INK_DIR, stdio: "inherit" });
}

// `bazel info bazel-bin` gives the real (symlinked) output root. It reports a
// config-specific path, so it MUST be passed the same `-c opt` as the build or
// it points at the wrong (empty) k8-fastbuild directory.
function bazelBin(bazel) {
  return execFileSync(bazel, ["info", "bazel-bin", ...COMPILATION_MODE, ...LOCKFILE_MODE], {
    cwd: INK_DIR,
  })
    .toString()
    .trim();
}

function collectVariant(bazel, variant) {
  // The wasm_cc_binary target name (e.g. "ink_wasm_umd") is also the output
  // subdirectory bazel emits into.
  const targetName = variant.bazelTarget.split(":")[1];
  const outDir = join(bazelBin(bazel), "wasm", targetName);
  if (!existsSync(outDir)) {
    throw new Error(`Expected output dir not found: ${outDir}`);
  }
  rmSync(variant.outDir, { recursive: true, force: true });
  mkdirSync(variant.outDir, { recursive: true });

  let copied = 0;
  for (const name of readdirSync(outDir)) {
    if (!/\.(js|wasm|worker\.js)$/.test(name)) continue;
    const src = join(outDir, name);
    // wasm_cc_binary always emits the full set of artifacts, several of them
    // empty placeholders (e.g. ink.wasm.debug.wasm when not building debug,
    // or ink.wasm itself for the asm.js/WASM=0 legacy variant). Skip
    // zero-byte files so each wasm-build* dir only holds real output.
    if (statSync(src).size === 0) continue;
    // Only the main glue file is renamed, to "ink.<jsExt>": our package.json
    // is "type": "module", so a plain .js extension always parses as ESM
    // regardless of its actual syntax — the CommonJS-shaped umd/legacy glue
    // needs the explicit .cjs extension to be recognized as CommonJS. The
    // .wasm (and any other sibling, e.g. .wasm.map) keeps bazel's name
    // (e.g. "ink_umd.wasm") unchanged: that exact filename is baked into the
    // glue at compile time as the default sibling asset to fetch, so
    // renaming it here would just make the glue 404 looking for the old name.
    const isMainGlue = name === `${variant.ccName}.js`;
    const destName = isMainGlue ? `ink.${variant.jsExt}` : name;
    const dest = join(variant.outDir, destName);
    copyFileSync(src, dest);
    const kb = (statSync(dest).size / 1024).toFixed(1);
    console.log(`  [${variant.name}] ${destName.padEnd(16)} ${kb.padStart(8)} KB`);
    copied++;
  }
  if (copied === 0) throw new Error(`No .js/.wasm artifacts in ${outDir}`);

  // Ship the TypeScript declarations for the emitted loader next to it, so the
  // wrappers in src/ type their `import createInkModule from "../wasm-build*/ink.*"`.
  // The Embind API surface is identical across variants, so one .d.ts covers
  // all; TS additionally requires a `.d.cts` twin to resolve a `.cjs` import.
  copyFileSync(join(WASM_SRC, "ink.d.ts"), join(variant.outDir, "ink.d.ts"));
  console.log(`  [${variant.name}] ${"ink.d.ts".padEnd(16)} ${"(types)".padStart(8)}`);
  if (variant.jsExt === "cjs") {
    copyFileSync(join(WASM_SRC, "ink.d.ts"), join(variant.outDir, "ink.d.cts"));
    console.log(`  [${variant.name}] ${"ink.d.cts".padEnd(16)} ${"(types)".padStart(8)}`);
  }
}

ensureSetup();
const bazel = pickBazel();
build(bazel);
for (const variant of WASM_VARIANTS) {
  collectVariant(bazel, variant);
  console.log(`✓ Wrote ${variant.name} glue to ${variant.outDir}\n`);
}
console.log("Next: rslib build  (or `pnpm build:js`)");
