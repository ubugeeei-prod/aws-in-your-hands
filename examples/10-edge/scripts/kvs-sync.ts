// vp run edge:kvs:plan   (reads the store, changes nothing)
// vp run edge:kvs:sync   (makes the store match edge-data.json)
//   node scripts/kvs-sync.ts [--dry-run] [--kvs-arn arn:aws:cloudfront::123456789012:key-value-store/...]

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { checkLimits, edgeDataSchema, toEntries } from "../src/kvs/config.ts";
import { describePlan, planSync } from "../src/kvs/plan.ts";
import { createKvsStore } from "../src/kvs/store.ts";
import { syncStore } from "../src/kvs/sync.ts";

const { values } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false }, "kvs-arn": { type: "string" } },
});

try {
  const desired = toEntries(
    edgeDataSchema.parse(JSON.parse(readFileSync("edge-data.json", "utf8"))),
  );
  const problems = checkLimits(desired);
  if (problems.length > 0) {
    throw new Error(
      `edge-data.json does not fit in a key value store:\n  ${problems.join("\n  ")}`,
    );
  }

  const dryRun = values["dry-run"];
  const { target } = await preflight({
    access: dryRun ? "observe" : "mutate",
    action: dryRun
      ? "compare edge-data.json with the key value store"
      : "update the key value store",
    stack: "AihEdge",
  });
  const kvsArn =
    values["kvs-arn"] ??
    requireOutput(
      await readStackOutputs(process.cwd(), "AihEdge", target.region),
      "KeyValueStoreArn",
    );
  // The store is global. Its API is served from us-east-1 whatever Region the stack is in.
  const store = createKvsStore(new CloudFrontKeyValueStoreClient({ region: "us-east-1" }), kvsArn);
  console.log(`store: ${kvsArn}`);

  if (dryRun) {
    const snapshot = await store.read();
    console.log(
      `${describePlan(planSync(desired, snapshot.entries))}\ndry run: nothing was changed.`,
    );
    process.exit(0);
  }

  const result = await syncStore(store, desired);
  for (const [index, plan] of result.plans.entries()) {
    console.log(`round ${index + 1}:\n${describePlan(plan)}`);
  }
  console.log(
    result.outcome === "already-in-sync"
      ? "already in sync: nothing was changed."
      : `applied after ${result.rounds} read(s) of the store. ETag is now ${result.etag}.`,
  );
  console.log(
    "Edge locations pick the change up on their own schedule. A request right now may still see the old value.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(
    "The sync did not finish. It is safe to run it again: it plans from what the store holds now.",
  );
  process.exit(1);
}
