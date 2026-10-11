// vp run sql:logs [--follow]
//   node scripts/logs.ts [--follow] [--since 15m]
// Each line is the JSON object written by src/log.ts. Search for a `requestId`,
// or for "transaction retry" to see how often commits conflicted.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const { values } = parseArgs({
  options: { follow: { type: "boolean", default: false }, since: { type: "string", default: "15m" } },
});

try {
  const { target } = await preflight({ access: "observe", action: "read function logs", stack: "AihSql" });
  const logGroup = requireOutput(await readStackOutputs(process.cwd(), "AihSql", target.region), "HandlerLogGroupName");
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
