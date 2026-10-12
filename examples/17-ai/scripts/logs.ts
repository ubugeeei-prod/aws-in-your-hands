// vp run ai:logs [--follow]
//   node scripts/logs.ts [--follow] [--since 15m]
//
// Shows the function's recent log lines. Each summary writes one JSON line
// with its outcome, attempts, and the tokens the model reported.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const { values } = parseArgs({
  options: {
    follow: { type: "boolean", default: false },
    since: { type: "string", default: "15m" },
  },
});

try {
  const { target } = await preflight({
    access: "observe",
    action: "read function logs",
    stack: "AihAi",
  });
  const logGroup = requireOutput(
    await readStackOutputs(process.cwd(), "AihAi", target.region),
    "HandlerLogGroupName",
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
