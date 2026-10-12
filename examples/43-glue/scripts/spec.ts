// vp run glue:spec    what the job has to write for the sample raw files
//   node scripts/spec.ts
//
// Runs the specification (src/curate.ts) and this chapter's reading of the data
// quality rules over made-up files. Local only: no Spark, no AWS.

import { scanPartitions } from "@aih/example-26-analytics/src/lake.ts";

import { curate } from "../src/curate.ts";
import { arrivalDays, curatedPrefix } from "../src/layout.ts";
import { evaluate, renderRuleset, RULES } from "../src/quality.ts";
import { SAMPLE_DAYS, sampleLake } from "../src/sample.ts";

const { objects } = sampleLake();
console.log(`raw: ${String(objects.length)} objects`);
for (const object of objects) {
  console.log(`  ${object.key}  ${String(object.bytes.byteLength)} bytes`);
}

for (const day of SAMPLE_DAYS) {
  const scan = scanPartitions(objects, arrivalDays(day));
  const rows = curate(scan.records, day);
  console.log(
    `\n${day}: ${String(scan.records.length)} records read from dt=${scan.partitions.join(", dt=")}`,
  );
  console.log(`  ${String(rows.length)} rows to ${curatedPrefix(day)}`);
  for (const { rule, outcome } of evaluate(RULES, rows)) {
    console.log(`  ${outcome}  ${rule}`);
  }
}

console.log(`\nthe ruleset, as the job is given it:\n${renderRuleset()}`);
