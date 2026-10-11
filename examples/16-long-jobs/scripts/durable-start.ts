// vp run export:durable:start [--id manual-1]    starts the durable-function export (changes AWS)
//   node scripts/durable-start.ts [--id manual-1]
//
// Needs the stack deployed with `-c durable=true`. The function is invoked
// asynchronously through its alias, with the export's ID as the execution name.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { toProgress } from "../src/job.ts";

const STACK = "AihLongJobs";
const { values } = parseArgs({ options: { id: { type: "string" } } });

try {
  const { exportId } = toProgress({
    exportId: values.id ?? `manual-${new Date().toISOString().replace(/\.\d+Z$/, "Z")}`,
  });
  const { target } = await preflight({ access: "mutate", action: `start durable export ${exportId}`, stack: STACK });
  const aliasArn = requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "DurableExportAliasArn");
  const response = await new LambdaClient({ region: target.region }).send(
    new InvokeCommand({
      // Qualified: a durable function cannot be invoked by its bare name.
      FunctionName: aliasArn,
      InvocationType: "Event",
      // The same name with the same payload does not start a second execution.
      DurableExecutionName: `export-${exportId}`,
      Payload: new TextEncoder().encode(JSON.stringify({ exportId })),
    }),
  );
  console.log(`accepted: HTTP ${response.StatusCode}`);
  console.log(`execution: ${response.DurableExecutionArn ?? "(no ARN returned)"}`);
  console.log(
    "Follow it in the Lambda console's Durable executions tab, or with `vp run export:logs --function durable`.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
