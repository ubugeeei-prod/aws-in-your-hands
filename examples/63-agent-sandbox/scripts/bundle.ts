// vp run sandbox:bundle
//   node scripts/bundle.ts
//
// Writes the two files the Dockerfile copies: dist/entry.mjs (the container's program)
// and dist/settings.json (Claude Code's settings, from src/agent.ts).

import { mkdirSync, statSync, writeFileSync } from "node:fs";

import { build } from "esbuild";

import { agentSettings } from "../src/agent.ts";

// #region bundle
await build({
  entryPoints: { entry: "src/entry.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
});

mkdirSync("dist", { recursive: true });
// The same object the tests read: the image cannot carry settings the tests did not see.
writeFileSync("dist/settings.json", `${JSON.stringify(agentSettings(), null, 2)}\n`);
// #endregion bundle

for (const file of ["dist/entry.mjs", "dist/settings.json"]) {
  console.log(`${file}: ${(statSync(file).size / 1024).toFixed(1)} KiB`);
}
