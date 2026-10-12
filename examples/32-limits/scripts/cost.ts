// vp run limits:cost:print     (local: prints the command, runs nothing)
// vp run limits:cost           (AWS: BILLED, USD 0.01 for every run)
//   node scripts/cost.ts [--print]
//
// This month's cost so far, split by the `project` tag and by service. Reads only.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";

import {
  breakdown,
  costAndUsageSchema,
  costByTagArgs,
  monthToDate,
  PROJECT_TAG_KEY,
} from "../src/cost.ts";

// The sample request in the API reference goes to ce.us-east-1.amazonaws.com, wherever the resources are.
const COST_EXPLORER_REGION = "us-east-1";

try {
  const { values } = parseArgs({ options: { print: { type: "boolean", default: false } } });
  const period = monthToDate(new Date());
  const args = [...costByTagArgs(period, PROJECT_TAG_KEY), "--region", COST_EXPLORER_REGION];
  if (values.print) {
    console.log(`aws ${args.join(" ")}`);
    process.exit(0);
  }

  await preflight({ access: "observe", action: "read cost and usage (billed: USD 0.01)" });
  const result = spawnSync("aws", [...args, "--output", "json"], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`aws ce get-cost-and-usage failed:\n${result.stderr}`);
  }
  const response = v.parse(costAndUsageSchema, JSON.parse(result.stdout));
  if (response.NextPageToken !== undefined) {
    // Each further page is another billed request. This script stops at one.
    console.error("There are more groups than one page holds; only the first page is shown.");
  }
  const { rows, taggedUsd, untaggedUsd } = breakdown(response, PROJECT_TAG_KEY);

  console.log(`${period.Start} up to ${period.End}, unblended cost in USD\n`);
  for (const row of rows) {
    console.log(
      `${row.usd.toFixed(4).padStart(10)}  ${(row.tagValue ?? "(no tag)").padEnd(12)}  ${row.service}`,
    );
  }
  console.log(`\n${taggedUsd.toFixed(4).padStart(10)}  with a ${PROJECT_TAG_KEY} tag`);
  console.log(`${untaggedUsd.toFixed(4).padStart(10)}  without one`);
  if (rows.every((row) => row.tagValue === undefined)) {
    console.log(
      `\nNothing carries the tag. Has "${PROJECT_TAG_KEY}" been activated as a cost allocation tag?`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
