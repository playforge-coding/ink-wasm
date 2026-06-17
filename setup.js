#!/usr/bin/env node
// setup.js — prepare the Google Ink checkout for a WebAssembly build.
//
// Idempotent. Running it repeatedly is safe. It will:
//   1. Shallow-clone Google Ink into ./ink (if not already present).
//   2. Register the emscripten Bazel toolchain (emsdk) in ink/MODULE.bazel.
//   3. Stage the //wasm build package (BUILD.bazel + bindings.cc) into the repo.
//
// Config via env vars:
//   INK_REF      git ref/tag/branch of Google Ink to check out (default: main)
//   EMSDK_VERSION emsdk release tag to use (default: 4.0.6)

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const INK_DIR = join(ROOT, "ink");
const WASM_SRC = join(ROOT, "wasm-src");

const INK_REPO = "https://github.com/google/ink.git";
const INK_REF = process.env.INK_REF || "main";
const EMSDK_VERSION = process.env.EMSDK_VERSION || "5.0.7";
// ink targets Bazel 7; Bazel 8+ removed native rules (e.g. cc_import) that its
// LLVM toolchain dependency still uses. Pin Bazel 7 so bazelisk fetches it.
const BAZEL_VERSION = process.env.BAZEL_VERSION || "7.4.1";

// Marker that lets us detect whether MODULE.bazel was already patched.
const PATCH_BEGIN = "# >>> ink-wasm: emscripten toolchain (added by setup.js)";
const PATCH_END = "# <<< ink-wasm";

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { stdio: "inherit", ...opts });
}

function cloneInk() {
  if (existsSync(join(INK_DIR, "MODULE.bazel"))) {
    console.log(`✓ ink already cloned at ${INK_DIR}`);
    return;
  }
  console.log(`Cloning Google Ink (${INK_REF}) ...`);
  run("git", ["clone", "--depth", "1", "--branch", INK_REF, INK_REPO, INK_DIR]);
  run("rm", ["-rf", `${INK_DIR}/.git`]);
}

function patchModuleBazel() {
  const modulePath = join(INK_DIR, "MODULE.bazel");
  let module = readFileSync(modulePath, "utf8");

  if (module.includes(PATCH_BEGIN)) {
    console.log("✓ MODULE.bazel already has the emscripten toolchain");
    return;
  }

  // emsdk is published to the Bazel Central Registry, so a plain bazel_dep is
  // all that's needed. wasm_cc_binary handles the toolchain transition, so no
  // .bazelrc platform configuration is required.
  // protobuf (an ink dep) pulls an older abseil at a different bzlmod
  // compatibility level than the one ink pins, which Bazel refuses to mix.
  // Forcing a single abseil version from the root module resolves the conflict
  // and bypasses the compatibility-level check.
  const block = [
    "",
    PATCH_BEGIN,
    `bazel_dep(name = "emsdk", version = "${EMSDK_VERSION}")`,
    "single_version_override(",
    '    module_name = "abseil-cpp",',
    '    version = "20260526.0",',
    ")",
    PATCH_END,
    "",
  ].join("\n");

  module += block;
  writeFileSync(modulePath, module);
  console.log(`✓ Registered emsdk ${EMSDK_VERSION} in MODULE.bazel`);
}

function stageWasmPackage() {
  const dest = join(INK_DIR, "wasm");
  mkdirSync(dest, { recursive: true });
  for (const file of ["BUILD.bazel", "bindings.cc"]) {
    copyFileSync(join(WASM_SRC, file), join(dest, file));
  }
  console.log(`✓ Staged //wasm package into ${dest}`);
}

function pinBazelVersion() {
  const path = join(INK_DIR, ".bazelversion");
  writeFileSync(path, BAZEL_VERSION + "\n");
  console.log(`✓ Pinned Bazel ${BAZEL_VERSION} (.bazelversion)`);
}

function main() {
  cloneInk();
  pinBazelVersion();
  patchModuleBazel();
  stageWasmPackage();
  console.log("\nSetup complete. Next: node build.js");
}

main();
