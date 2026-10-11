// vp run mail:logs [--events] [--follow] [--since 15m]
//
// Tails the sending function's log group, or with --events the group of the
// function that records bounces, complaints and deliveries.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const { values } = parseArgs({
  options: {
    events: { type: "boolean", default: false },
    follow: { type: "boolean", default: false },
    since: { type: "string", default: "15m" },
  },
});

try {
  const { target } = await preflight({ access: "observe", action: "read function logs", stack: "AihEmail" });
  const logGroup = requireOutput(
    await readStackOutputs(process.cwd(), "AihEmail", target.region),
    values.events ? "EventLogGroupName" : "ApiLogGroupName",
  );
  const args = ["logs", "tail", logGroup, "--region", target.region, "--since", values.since, "--format", "short"];
  if (values.follow) {
    args.push("--follow");
  }
  console.error(`$ aws ${args.join(" ")}`);
  process.exit(spawnSync("aws", args, { stdio: "inherit" }).status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
