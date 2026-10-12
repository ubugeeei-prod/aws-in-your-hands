// vp run ecr:lifecycle:preview
//   node scripts/lifecycle-preview.ts [describe-images.json] [--now 2026-10-13T00:00:00Z] [--in-use sha256:...]
//
// Runs this chapter's evaluator over a saved `aws ecr describe-images` output and
// prints what the policy would expire. No AWS. It is not ECR's own preview.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { toImages } from "../src/describe.ts";
import { evaluate, expiredInUse } from "../src/lifecycle.ts";
import { POLICY } from "../src/policy.ts";

const FIXTURE = "fixtures/describe-images.json";
// The fixture's dates are fixed, so the default clock is too.
const FIXTURE_NOW = "2026-10-13T00:00:00Z";

const { values, positionals } = parseArgs({
  options: { now: { type: "string" }, "in-use": { type: "string", multiple: true, default: [] } },
  allowPositionals: true,
});

try {
  const file = positionals[0] ?? FIXTURE;
  const now = new Date(values.now ?? (file === FIXTURE ? FIXTURE_NOW : Date.now()));
  if (Number.isNaN(now.getTime())) {
    throw new Error(`--now ${values.now} is not a date`);
  }
  const images = toImages(JSON.parse(readFileSync(file, "utf8")));
  const expired = evaluate(POLICY, images, now);

  console.log(`${images.length} images in ${file}, evaluated at ${now.toISOString()}`);
  for (const rule of POLICY.rules) {
    const mine = expired.filter((image) => image.rulePriority === rule.rulePriority);
    console.log(`rule ${rule.rulePriority} (${rule.description}): expires ${mine.length}`);
    for (const image of mine) {
      console.log(`  ${image.digest.slice(0, 19)}  ${image.tags.join(", ") || "(untagged)"}`);
    }
  }
  console.log(`kept: ${images.length - expired.length}`);

  const lost = expiredInUse(expired, values["in-use"]);
  if (lost.length > 0) {
    console.error(`${lost.length} image(s) named by --in-use would be deleted`);
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
