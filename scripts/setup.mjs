// setup.mjs — prepare the Google Ink checkout for a WebAssembly build.
//
// Idempotent. Running it repeatedly is safe. It will:
//   1. Check out the `ink` git submodule (pinned revision, see .gitmodules).
//   2. Pin the Bazel version ink's lockfile requires (ink/.bazelversion).
//   3. Register the emscripten Bazel toolchain (emsdk) in ink/MODULE.bazel.
//   4. Stage the //wasm build package (BUILD.bazel + bindings.cc) into the repo.
//
// Steps 2-4 write inside the submodule, so `git status` will report it as
// having modified content. That is expected; .gitmodules sets `ignore = dirty`
// so only the pinned revision is tracked.
//
// Config via env vars:
//   INK_REF        git ref/tag/branch to check out INSTEAD of the pinned
//                  submodule revision (escape hatch for testing newer upstream)
//   EMSDK_VERSION  emsdk release tag to use (default: 5.0.7)
//   BAZEL_VERSION  Bazel version to pin (default: 8.7.0)

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { INK_DIR, WASM_SRC, VERSIONS, run } from "./common.mjs";

// Marker that lets us detect whether MODULE.bazel was already patched.
const PATCH_BEGIN = "# >>> ink-wasm: emscripten toolchain (added by setup.mjs)";
const PATCH_END = "# <<< ink-wasm";

/** Short SHA of the revision the submodule is currently checked out at. */
function inkRevision() {
  const res = spawnSync("git", ["-C", INK_DIR, "rev-parse", "--short", "HEAD"], {
    encoding: "utf8",
  });
  return res.status === 0 ? res.stdout.trim() : "unknown";
}

// The ink revision is pinned by the submodule gitlink, so a checkout of this
// repo always builds against the exact upstream tree it was tested with —
// upstream `main` moves (and has, mid-release, changed the Bazel version it
// requires), which a floating clone would silently pick up.
function checkoutInk() {
  if (!existsSync(join(INK_DIR, "MODULE.bazel"))) {
    console.log("Checking out the ink submodule ...");
    // Shallow: only the pinned commit is needed, and ink's full history is
    // several hundred MB. Falls back to a complete fetch on the (rare) server
    // that refuses a by-SHA fetch.
    try {
      run("git", ["submodule", "update", "--init", "--depth", "1", "ink"]);
    } catch {
      console.warn("⚠ Shallow submodule fetch failed; retrying with full history.");
      run("git", ["submodule", "update", "--init", "ink"]);
    }
  }

  if (process.env.INK_REF) {
    // Escape hatch: build against a different upstream ref without moving the
    // pin. The submodule is left detached at that ref; `git submodule update`
    // puts it back.
    console.log(`INK_REF set — checking out ink @ ${process.env.INK_REF}`);
    run("git", ["-C", INK_DIR, "fetch", "--depth", "1", "origin", process.env.INK_REF]);
    run("git", ["-C", INK_DIR, "checkout", "--force", "FETCH_HEAD"]);
  }

  if (!existsSync(join(INK_DIR, "MODULE.bazel"))) {
    throw new Error(
      `No ink checkout at ${INK_DIR}. This repo pins Google Ink as a git ` +
        "submodule — clone with `git clone --recurse-submodules`, or run " +
        "`git submodule update --init --depth 1 ink`.",
    );
  }
  console.log(`✓ ink submodule at ${INK_DIR} (${inkRevision()})`);
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

checkoutInk();
pinBazelVersion();
patchModuleBazel();
stageWasmPackage();
console.log("\nSetup complete. Next: node scripts/build-wasm.mjs");
