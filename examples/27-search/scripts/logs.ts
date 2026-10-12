// vp run search:logs [-- --indexer] [--follow]
//   node scripts/logs.ts [--indexer] [--follow] [--since 15m]
//
// Shows the recent log lines of the search function, or of the indexer.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const { values } = parseArgs({
  options: {
    indexer: { type: "boolean", default: false },
    follow: { type: "boolean", default: false },
    since: { type: "string", default: "15m" },
  },
});

try {
  const { target } = await preflight({
    access: "observe",
    action: "read function logs",
    stack: "AihSearch",
  });
  const logGroup = requireOutput(
    await readStackOutputs(process.cwd(), "AihSearch", target.region),
    values.indexer ? "IndexerLogGroupName" : "SearchLogGroupName",
  );
  const args = ["logs", "tail", logGroup, "--region", target.region, "--since", values.since];
  args.push("--format", "short");
  if (values.follow) {
    args.push("--follow");
  }
  console.error(`$ aws ${args.join(" ")}`);
  process.exit(spawnSync("aws", args, { stdio: "inherit" }).status ?? 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
