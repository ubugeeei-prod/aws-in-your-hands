// vp run isolates:bundle
//   node scripts/bundle.ts
//
// Writes dist/: one bundle per worker, and the configuration the container runs.
// The Dockerfile copies dist/config.capnp and dist/notes.mjs, and nothing else from here.

import { mkdirSync, statSync, writeFileSync } from "node:fs";

import { bundleWorker } from "../src/bundle.ts";
import { renderConfig } from "../src/capnp.ts";
import { BUNDLES, imageDeployment } from "../src/deployments.ts";

mkdirSync("dist", { recursive: true });
for (const { entry, module } of Object.values(BUNDLES)) {
  await bundleWorker(entry, `dist/${module}`);
  console.log(`dist/${module}: ${(statSync(`dist/${module}`).size / 1024).toFixed(1)} KiB`);
}
writeFileSync("dist/config.capnp", renderConfig(imageDeployment));
console.log("dist/config.capnp");
