// Shared helpers and configuration for the build scripts.
// Pure Node.js so the build works identically on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the package root. */
export const ROOT = resolve(__dirname, "..");

/** The Google Ink checkout, cloned and patched by setup.mjs. */
export const INK_DIR = resolve(ROOT, "ink");

/** Hand-written Bazel package + Embind bindings staged into the ink checkout. */
export const WASM_SRC = resolve(ROOT, "wasm-src");

/** Where the Emscripten .js glue, .wasm and .d.ts are collected. */
export const WASM_OUT = resolve(ROOT, "wasm-build");

/** The wasm_cc_binary Bazel target inside the ink checkout. */
export const BAZEL_TARGET = "//wasm:ink_wasm";

/** Pinned upstream / toolchain versions. */
export const VERSIONS = {
  ink: process.env.INK_REF || "main",
  emsdk: process.env.EMSDK_VERSION || "5.0.7",
  // ink targets Bazel 7; Bazel 8+ removed native rules its toolchain deps use.
  bazel: process.env.BAZEL_VERSION || "7.4.1",
};

/**
 * Run a command, inheriting stdio, and throw on a non-zero exit code.
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
export function run(cmd, args, opts = {}) {
  const printable = [cmd, ...args]
    .map((a) => (a.includes(" ") ? JSON.stringify(a) : a))
    .join(" ");
  console.log(`\n$ ${printable}\n`);
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Command failed (exit ${res.status}): ${cmd}`);
  }
}

/** True if `bin --version` exits 0. */
function which(bin) {
  return spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
}

/**
 * Pick the Bazel launcher. Prefer bazelisk: it honors ink/.bazelversion and
 * fetches the pinned Bazel 7 (Bazel 8+ removed native rules ink still uses).
 */
export function pickBazel() {
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
