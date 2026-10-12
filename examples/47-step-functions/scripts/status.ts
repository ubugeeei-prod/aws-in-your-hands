// vp run sfn:status                       the latest imports and where each one stopped (reads AWS)
// vp run sfn:status --redrive <arn>       resumes a failed import from the state it stopped in (changes AWS)
//   node scripts/status.ts [--redrive <execution ARN>]

import { parseArgs } from "node:util";

import {
  GetExecutionHistoryCommand,
  ListExecutionsCommand,
  RedriveExecutionCommand,
  SFNClient,
} from "@aws-sdk/client-sfn";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const STACK = "AihStepFunctions";
const { values } = parseArgs({ options: { redrive: { type: "string" } } });

try {
  const { target } = await preflight({
    access: values.redrive === undefined ? "observe" : "mutate",
    action: values.redrive === undefined ? "read the imports" : "redrive a failed import",
    stack: STACK,
  });
  const sfn = new SFNClient({ region: target.region });

  if (values.redrive !== undefined) {
    // The failed state runs again with the input it had. Possible for 14 days after the failure.
    const redriven = await sfn.send(new RedriveExecutionCommand({ executionArn: values.redrive }));
    console.log(`redriven at ${redriven.redriveDate?.toISOString() ?? "?"}`);
    process.exit(0);
  }

  const { executions = [] } = await sfn.send(
    new ListExecutionsCommand({
      stateMachineArn: requireOutput(
        await readStackOutputs(process.cwd(), STACK, target.region),
        "ImportNoteArn",
      ),
      maxResults: 5,
    }),
  );
  for (const execution of executions) {
    // Newest first: the last state entered is where a RUNNING import waits, or a FAILED one stopped.
    const history = await sfn.send(
      new GetExecutionHistoryCommand({
        executionArn: execution.executionArn,
        reverseOrder: true,
        maxResults: 20,
      }),
    );
    const last = history.events?.find((event) => event.stateEnteredEventDetails !== undefined);
    console.log(
      `${execution.status}  ${execution.name}  last state ${last?.stateEnteredEventDetails?.name ?? "?"}  ` +
        `history events ${history.events?.[0]?.id ?? "?"}  redrives ${execution.redriveCount ?? 0}`,
    );
    if (execution.status !== "SUCCEEDED" && execution.status !== "RUNNING") {
      console.log(`  ${execution.executionArn}`);
    }
  }
  if (executions.length === 0) {
    console.log("no imports yet");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
