// Shared helpers and configuration for the build scripts.
// Pure Node.js so the build works identically on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the package root. */
export const ROOT = resolve(__dirname, "..");

/** The Google Ink checkout: a git submodule pinned in .gitmodules, patched by setup.mjs. */
export const INK_DIR = resolve(ROOT, "ink");

/** Hand-written Bazel package + Embind bindings staged into the ink checkout. */
export const WASM_SRC = resolve(ROOT, "wasm-src");

/** Where the Emscripten .js glue, .wasm and .d.ts are collected. */
export const WASM_OUT = resolve(ROOT, "wasm-build");

/** The wasm_cc_binary Bazel target inside the ink checkout. */
export const BAZEL_TARGET = "//wasm:ink_wasm";

/**
 * The three Emscripten glue variants built from the same C++ source (see
 * wasm-src/BUILD.bazel). Each is collected into its own directory so tsdown
 * can bundle them into separate outputs (ESM, UMD, and the wasm-free legacy
 * fallback).
 */
export const WASM_VARIANTS = [
  {
    name: "esm",
    bazelTarget: "//wasm:ink_wasm",
    // Basename of the underlying cc_binary (see wasm-src/BUILD.bazel) —
    // bazel names the emitted .js/.wasm after it (e.g. "ink_umd.js").
    ccName: "ink",
    outDir: resolve(ROOT, "wasm-build"),
    // The ESM glue has real `export` statements (EXPORT_ES6), so a plain
    // .js extension resolves as ESM (our package.json is "type": "module").
    jsExt: "js",
  },
  {
    name: "umd",
    bazelTarget: "//wasm:ink_wasm_umd",
    ccName: "ink_umd",
    outDir: resolve(ROOT, "wasm-build-umd"),
    // The classic-script glue is CommonJS-shaped (`module.exports = ...`).
    // With "type": "module" in package.json, a plain .js would be parsed as
    // ESM regardless of its actual syntax, so this needs the .cjs extension
    // to force CommonJS parsing.
    jsExt: "cjs",
  },
  {
    name: "legacy",
    bazelTarget: "//wasm:ink_wasm_legacy",
    ccName: "ink_legacy",
    outDir: resolve(ROOT, "wasm-build-legacy"),
    jsExt: "cjs",
  },
];

/**
 * Pinned upstream / toolchain versions.
 *
 * The ink revision is NOT listed here: it is pinned by the `ink` git submodule
 * (see .gitmodules), so there is exactly one place to bump it. Setting INK_REF
 * overrides that pin by checking out another ref inside the submodule — for
 * trying a newer upstream, not for normal builds.
 */
export const VERSIONS = {
  emsdk: process.env.EMSDK_VERSION || "5.0.7",
  // ink ships a Bazel 8 lockfile (lockFileVersion 24) and its CI runs 8.7.0;
  // Bazel 7 cannot even read that lockfile.
  bazel: process.env.BAZEL_VERSION || "8.7.0",
};

/**
 * Run a command, inheriting stdio, and throw on a non-zero exit code.
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
export function run(cmd, args, opts = {}) {
  const printable = [cmd, ...args].map((a) => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ");
  console.log(`\n$ ${printable}\n`);
  const res = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`Command failed (exit ${res.status}): ${cmd}`);
  }
}

/** `bin --version` output ("bazel 8.7.0"), or null if the binary isn't runnable. */
function versionOf(bin) {
  const res = spawnSync(bin, ["--version"], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

/**
 * Pick the Bazel launcher. Prefer bazelisk: it honors ink/.bazelversion (which
 * setup.mjs writes) and downloads the exact Bazel the pinned ink revision
 * expects. A plain `bazel` only works if it already is a matching major: ink's
 * checked-in MODULE.bazel.lock is Bazel 8 format, and Bazel 7 refuses to read
 * it with a message that says nothing about the real cause. Fail here instead,
 * with instructions.
 */
export function pickBazel() {
  if (process.env.BAZEL) return process.env.BAZEL;
  if (versionOf("bazelisk")) return "bazelisk";

  const version = versionOf("bazel");
  if (!version) throw new Error("Neither bazelisk nor bazel found on PATH.");

  const [wantMajor] = VERSIONS.bazel.split(".");
  const gotMajor = (version.match(/(\d+)\./) || [])[1];
  if (gotMajor !== wantMajor) {
    throw new Error(
      `ink needs Bazel ${VERSIONS.bazel}, but \`bazel --version\` reports ` +
        `"${version}". Install bazelisk (it reads ink/.bazelversion and ` +
        "fetches the right release), or point the build at a matching binary " +
        `with BAZEL=/path/to/bazel-${VERSIONS.bazel}.`,
    );
  }
  if (!version.endsWith(VERSIONS.bazel)) {
    console.warn(`⚠ bazelisk not found; using ${version} (ink pins ${VERSIONS.bazel}).`);
  }
  return "bazel";
}
