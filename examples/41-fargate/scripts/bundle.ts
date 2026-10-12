// vp run fargate:bundle
//   node scripts/bundle.ts
//
// Writes dist/server.mjs (chapter 12's server, unchanged) and dist/job.mjs
// (this chapter's job). These two files are all the Dockerfile copies.

import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

// #region bundle
const entries = {
  // Resolved through the workspace dependency: the server is chapter 12's file, not a copy of it.
  server: fileURLToPath(import.meta.resolve("@aih/example-12-containers/src/server.ts")),
  job: "src/job-main.ts",
};

await build({
  entryPoints: entries,
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: false,
  sourcemap: false,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: "warning",
});
// #endregion bundle

for (const name of Object.keys(entries)) {
  const file = `dist/${name}.mjs`;
  console.log(`${file}: ${(statSync(file).size / 1024).toFixed(1)} KiB`);
}
