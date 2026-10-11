// vp run ecs:bundle
//   node scripts/bundle.ts
//
// Writes dist/server.mjs: the server and everything it imports, as one file.
// This is the only file the Dockerfile copies into the image.
import { statSync } from "node:fs";
import { build } from "esbuild";

// #region bundle
const outfile = "dist/server.mjs";

await build({
  entryPoints: ["src/server.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  // The Node.js major version of the base image in the Dockerfile.
  target: "node24",
  minify: false,
  sourcemap: false,
  // A dependency that reaches for require() would not find it in an ES module.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});
// #endregion bundle

console.log(`${outfile}: ${(statSync(outfile).size / 1024).toFixed(1)} KiB`);
