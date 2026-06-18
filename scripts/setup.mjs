// setup.mjs — prepare the Google Ink checkout for a WebAssembly build.
//
// Idempotent. Running it repeatedly is safe. It will:
//   1. Shallow-clone Google Ink into ./ink (if not already present).
//   2. Pin Bazel 7 (ink targets it; Bazel 8+ dropped rules its deps use).
//   3. Register the emscripten Bazel toolchain (emsdk) in ink/MODULE.bazel.
//   4. Stage the //wasm build package (BUILD.bazel + bindings.cc) into the repo.
//
// Config via env vars:
//   INK_REF        git ref/tag/branch of Google Ink to check out (default: main)
//   EMSDK_VERSION  emsdk release tag to use (default: 5.0.7)
//   BAZEL_VERSION  Bazel version to pin (default: 7.4.1)

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INK_DIR, WASM_SRC, VERSIONS, run } from "./common.mjs";

const INK_REPO = "https://github.com/google/ink.git";

// Marker that lets us detect whether MODULE.bazel was already patched.
const PATCH_BEGIN = "# >>> ink-wasm: emscripten toolchain (added by setup.mjs)";
const PATCH_END = "# <<< ink-wasm";

function cloneInk() {
  if (existsSync(join(INK_DIR, "MODULE.bazel"))) {
    console.log(`✓ ink already cloned at ${INK_DIR}`);
    return;
  }
  console.log(`Cloning Google Ink (${VERSIONS.ink}) ...`);
  run("git", ["clone", "--depth", "1", "--branch", VERSIONS.ink, INK_REPO, INK_DIR]);
  run("rm", ["-rf", join(INK_DIR, ".git")]);
}

function pinBazelVersion() {
  writeFileSync(join(INK_DIR, ".bazelversion"), VERSIONS.bazel + "\n");
  console.log(`✓ Pinned Bazel ${VERSIONS.bazel} (.bazelversion)`);
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
    `bazel_dep(name = "emsdk", version = "${VERSIONS.emsdk}")`,
    "single_version_override(",
    '    module_name = "abseil-cpp",',
    '    version = "20260526.0",',
    ")",
    PATCH_END,
    "",
  ].join("\n");

  module += block;
  writeFileSync(modulePath, module);
  console.log(`✓ Registered emsdk ${VERSIONS.emsdk} in MODULE.bazel`);
}

function stageWasmPackage() {
  const dest = join(INK_DIR, "wasm");
  mkdirSync(dest, { recursive: true });
  for (const file of ["BUILD.bazel", "bindings.cc"]) {
    copyFileSync(join(WASM_SRC, file), join(dest, file));
  }
  console.log(`✓ Staged //wasm package into ${dest}`);
}

cloneInk();
pinBazelVersion();
patchModuleBazel();
stageWasmPackage();
console.log("\nSetup complete. Next: node scripts/build-wasm.mjs");
