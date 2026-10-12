// vp run firecracker:spec
//   node scripts/spec.ts [--write]
//
// Downloads the pinned specification from GitHub, checks its SHA-256, cuts out the used part,
// and compares it with spec/firecracker-v<version>.subset.json. Reads the network, not AWS.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { parse } from "yaml";

import { extractSubset, SPEC } from "../src/spec.ts";
import { SUBSET_FILE } from "../src/subset.ts";

const response = await fetch(SPEC.url);
if (!response.ok) {
  throw new Error(`GET ${SPEC.url} answered ${response.status}`);
}
const bytes = Buffer.from(await response.arrayBuffer());
const sha256 = createHash("sha256").update(bytes).digest("hex");
if (sha256 !== SPEC.sha256) {
  throw new Error(`${SPEC.url}\n  has sha256 ${sha256}\n  expected   ${SPEC.sha256}`);
}
mkdirSync(".cache", { recursive: true });
writeFileSync(`.cache/firecracker-v${SPEC.version}.yaml`, bytes);

const subset = extractSubset(parse(bytes.toString("utf8")));
const fresh = `${JSON.stringify(subset, null, 2)}\n`;
// Compared as data: the formatter may lay the committed file out differently.
const committed = (() => {
  try {
    return JSON.stringify(JSON.parse(readFileSync(SUBSET_FILE, "utf8")));
  } catch {
    return undefined;
  }
})();

if (JSON.stringify(subset) === committed) {
  console.log(`${SUBSET_FILE} matches the specification of Firecracker ${SPEC.version}`);
} else if (process.argv.includes("--write")) {
  writeFileSync(SUBSET_FILE, fresh);
  console.log(`wrote ${SUBSET_FILE} (${Buffer.byteLength(fresh)} bytes)`);
} else {
  console.error(`${SUBSET_FILE} differs from the specification. Run with --write and review.`);
  process.exitCode = 1;
}
