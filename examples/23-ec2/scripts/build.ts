// vp run ec2:app:build
//   node scripts/build.ts
//
// One file that Node.js on the instance can run with nothing installed beside it.

import { readFileSync } from "node:fs";

import { build } from "esbuild";

import { releaseVersion } from "../src/release.ts";

const outfile = "dist/server.mjs";

await build({
  entryPoints: ["src/server.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Readable stack traces on the instance matter more than a smaller file.
  minify: false,
  logLevel: "warning",
});

const bundle = readFileSync(outfile);
console.log(
  `${outfile}: ${bundle.byteLength} bytes, sha256 prefix ${releaseVersion(bundle, new Date(0)).split("-")[1]}`,
);
