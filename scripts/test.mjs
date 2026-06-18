// Smoke-test the built bundle in Node: load the wasm and run the real stroke
// pipeline. Delegates to examples/node-test.mjs so the example stays runnable.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { ROOT, run } from "./common.mjs";

if (!existsSync(resolve(ROOT, "dist", "index.js"))) {
  throw new Error("dist/ not built. Run `pnpm build` first.");
}

run("node", ["examples/node-test.mjs"]);
