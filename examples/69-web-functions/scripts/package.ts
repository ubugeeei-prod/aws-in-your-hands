// vp run webfn:package
//   node scripts/package.ts
//
// Writes dist/function.zip: what a revision is made from. Local; touches nothing in AWS.

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

import { packageZip } from "./build.ts";

const archive = await packageZip();
mkdirSync("dist", { recursive: true });
writeFileSync("dist/function.zip", archive);
console.log(`dist/function.zip: ${(archive.length / 1024).toFixed(1)} KiB`);
// Recorded next to the S3 version ID, the checksum says which build a revision runs.
console.log(`sha256: ${createHash("sha256").update(archive).digest("hex")}`);
