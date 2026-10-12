// vp run cloudshell:build
//   node scripts/build.ts
//
// Writes dist/aih-cloudshell.mjs: the file to upload to CloudShell.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { build } from "esbuild";

import { BUNDLE, bundleOptions } from "./bundle.ts";

await build(bundleOptions(BUNDLE));

const bundle = readFileSync(BUNDLE);
console.log(
  `${BUNDLE}: ${bundle.byteLength} bytes, sha256 ${createHash("sha256").update(bundle).digest("hex")}`,
);
