// node scripts/kvs-file.ts <out.json>
// Writes edge-data.json as the flat { "key": "value" } map that `cdkd local start-cloudfront --kvs-file` reads.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import * as v from "valibot";

import { edgeDataSchema, toEntries } from "../src/kvs/config.ts";

const out = process.argv[2];
if (out === undefined) {
  console.error("usage: kvs-file.ts <out.json>");
  process.exit(64);
}
const entries = toEntries(
  v.parse(edgeDataSchema, JSON.parse(readFileSync("edge-data.json", "utf8"))),
);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
console.log(`wrote ${entries.size} pairs to ${out}`);
