#!/usr/bin/env node
// build.js — compile Google Ink to WebAssembly and collect the artifacts.
//
// Runs `bazel build //wasm:ink_wasm` inside the ink checkout (using the
// emscripten toolchain registered by setup.js), then copies the emitted
// .js/.wasm into ./dist.
//
// Config via env vars:
//   BAZEL        bazel binary to use (default: bazelisk if present, else bazel)
//   BAZEL_ARGS   extra args appended to the build (e.g. "--sandbox_debug")

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const INK_DIR = join(ROOT, "ink");
const WASM_SRC = join(ROOT, "wasm-src");
const DIST = join(ROOT, "dist");
const TARGET = "//wasm:ink_wasm";

function which(bin) {
  return spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
}

function pickBazel() {
  // Prefer bazelisk: it honors ink/.bazelversion and fetches the pinned Bazel 7
  // (Bazel 8+ removed native rules that ink's toolchain deps still use).
  if (process.env.BAZEL) return process.env.BAZEL;
  if (which("bazelisk")) return "bazelisk";
  if (which("bazel")) {
    console.warn(
      "⚠ bazelisk not found; using bazel. ink needs Bazel 7 — " +
        "if this fails, install bazelisk or set BAZEL=path/to/bazel-7.",
    );
    return "bazel";
  }
  throw new Error("Neither bazelisk nor bazel found on PATH.");
}

function ensureSetup() {
  if (!existsSync(join(INK_DIR, "wasm", "BUILD.bazel"))) {
    throw new Error("ink/wasm not staged. Run `node setup.js` first.");
  }
}

// The compilation mode determines the output path (k8-opt vs k8-fastbuild), so
// it must be applied to both `build` and `info bazel-bin`.
const COMPILATION_MODE = ["-c", "opt"];

function build(bazel) {
  const extra = process.env.BAZEL_ARGS ? process.env.BAZEL_ARGS.split(" ") : [];
  const args = ["build", ...COMPILATION_MODE, TARGET, ...extra];
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
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  let copied = 0;
  for (const name of readdirSync(outDir)) {
    if (!/\.(js|wasm|mjs|worker\.js)$/.test(name)) continue;
    const src = join(outDir, name);
    // wasm_cc_binary always emits the full set of artifacts, several of them
    // empty placeholders (e.g. ink.wasm.debug.wasm when not building debug).
    // Skip zero-byte files so dist only holds the real loader + wasm.
    if (statSync(src).size === 0) continue;
    // Emscripten emits ES6 module syntax (EXPORT_ES6); ship the loader as .mjs
    // so Node treats it as an ES module without a package.json type override.
    const destName = name === "ink.js" ? "ink.mjs" : name;
    const dest = join(DIST, destName);
    copyFileSync(src, dest);
    const kb = (statSync(dest).size / 1024).toFixed(1);
    console.log(`  ${destName.padEnd(16)} ${kb.padStart(8)} KB`);
    copied++;
  }
  if (copied === 0) throw new Error(`No .js/.wasm artifacts in ${outDir}`);

  // Ship the TypeScript declarations next to the loader. The emitted loader is
  // renamed ink.js -> ink.mjs, and ink.d.ts applies to it by basename.
  copyFileSync(join(WASM_SRC, "ink.d.ts"), join(DIST, "ink.d.ts"));
  console.log(`  ${"ink.d.ts".padEnd(16)} ${"(types)".padStart(8)}`);
  copied++;

  console.log(`\n✓ Wrote ${copied} file(s) to ${DIST}`);
}

function main() {
  ensureSetup();
  const bazel = pickBazel();
  build(bazel);
  collect(bazel);
  console.log("\nTry it:  node examples/node-test.mjs");
}

main();
