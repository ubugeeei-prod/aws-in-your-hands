// vp run export:logs [--function pages|finish|discard|durable] [--follow]
//   node scripts/logs.ts [--function pages] [--follow] [--since 15m]
//
// Each function writes one JSON line per call, with the export's ID.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { z } from "zod";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const STACK = "AihLongJobs";
const OUTPUTS = {
  pages: "ExportPagesLogGroupName",
  finish: "FinishLogGroupName",
  discard: "DiscardLogGroupName",
  durable: "DurableExportLogGroupName",
};
const { values } = parseArgs({
  options: {
    function: { type: "string", default: "pages" },
    follow: { type: "boolean", default: false },
    since: { type: "string", default: "15m" },
  },
});
const which = z.enum(["pages", "finish", "discard", "durable"]).safeParse(values.function);
if (!which.success) {
  console.error("--function must be pages, finish, discard, or durable");
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
    OUTPUTS[which.data],
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
