// vp run export:start [--id manual-1] [--wait]    starts one export now (changes AWS)
//   node scripts/start.ts [--id manual-1] [--wait]
//
// The execution is named after the export. Starting the same ID again while
// it runs returns the same execution; after it has closed, Step Functions
// answers ExecutionAlreadyExists.

import { parseArgs } from "node:util";

import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { toProgress } from "../src/job.ts";

const STACK = "AihLongJobs";
const { values } = parseArgs({
  options: { id: { type: "string" }, wait: { type: "boolean", default: false } },
});

try {
  // Validated here with the function's own rule, so a bad ID fails before anything starts.
  const { exportId } = toProgress({
    exportId: values.id ?? `manual-${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`,
  });
  const { target } = await preflight({
    access: "mutate",
    action: `start export ${exportId}`,
    stack: STACK,
  });
  const stateMachineArn = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "ExportWorkflowArn",
  );
  const sfn = new SFNClient({ region: target.region });
  const started = await sfn.send(
    new StartExecutionCommand({
      stateMachineArn,
      name: `export-${exportId}`,
      input: JSON.stringify({ exportId }),
    }),
  );
  console.log(`execution: ${started.executionArn}`);
  if (!values.wait) {
    console.log("Run `vp run export:status` to follow it.");
    process.exit(0);
  }
  // Up to ten minutes. A longer export keeps running; only this script stops watching.
  for (let attempt = 0; attempt < 120; attempt++) {
    const execution = await sfn.send(
      new DescribeExecutionCommand({ executionArn: started.executionArn }),
    );
    if (execution.status !== "RUNNING") {
      console.log(`status: ${execution.status}`);
      console.log(execution.output ?? `${execution.error ?? ""} ${execution.cause ?? ""}`.trim());
      process.exit(execution.status === "SUCCEEDED" ? 0 : 1);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  console.log("still running after ten minutes");
  process.exit(1);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
