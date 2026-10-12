// vp run async:logs [--function worker|housekeeping] [--follow]
//   node scripts/logs.ts [--function worker] [--follow] [--since 15m]
//
// The worker writes one JSON line per event, with the message ID, the key,
// and what it did (`status`). A failed message has `"message":"message failed"`.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { z } from "zod";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const STACK = "AihAsync";
const { values } = parseArgs({
  options: {
    function: { type: "string", default: "worker" },
    follow: { type: "boolean", default: false },
    since: { type: "string", default: "15m" },
  },
});
const which = z.enum(["worker", "housekeeping"]).safeParse(values.function);
if (!which.success) {
  console.error("--function must be worker or housekeeping");
  process.exit(64);
}

try {
  const { target } = await preflight({
    access: "observe",
    action: `read the ${which.data} logs`,
    stack: STACK,
  });
  const logGroup = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    which.data === "worker" ? "WorkerLogGroupName" : "HousekeepingLogGroupName",
  );
  const args = [
    "logs",
    "tail",
    logGroup,
    "--region",
    target.region,
    "--since",
    values.since,
    "--format",
    "short",
  ];
  if (values.follow) {
    args.push("--follow");
  }
  console.error(`$ aws ${args.join(" ")}`);
  process.exit(spawnSync("aws", args, { stdio: "inherit" }).status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
