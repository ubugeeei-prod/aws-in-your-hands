// vp run sfn:digest [--owner user-1] [--ids note-1,note-2]    runs the Express workflow and waits for its answer (reads AWS)
//   node scripts/digest.ts ...

import { parseArgs } from "node:util";

import { SFNClient, StartSyncExecutionCommand } from "@aws-sdk/client-sfn";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { digestInputSchema, digestOutputSchema } from "../src/digest.ts";

const STACK = "AihStepFunctions";
const { values } = parseArgs({
  options: {
    owner: { type: "string", default: "user-1" },
    ids: { type: "string", default: "note-1" },
  },
});

try {
  const input = v.parse(digestInputSchema, { owner: values.owner, noteIds: values.ids.split(",") });
  const { target } = await preflight({
    access: "observe",
    action: `look up ${input.noteIds.length} notes`,
    stack: STACK,
  });
  const result = await new SFNClient({ region: target.region }).send(
    new StartSyncExecutionCommand({
      stateMachineArn: requireOutput(
        await readStackOutputs(process.cwd(), STACK, target.region),
        "NoteDigestArn",
      ),
      input: JSON.stringify(input),
    }),
  );
  // The call answers 200 even when the execution failed. The status is in the body.
  if (result.status !== "SUCCEEDED" || result.output === undefined) {
    throw new Error(`${result.status}: ${result.error ?? ""} ${result.cause ?? ""}`.trim());
  }
  const digest = v.parse(digestOutputSchema, JSON.parse(result.output));
  for (const note of digest.notes) {
    console.log(`${note.found ? "found  " : "missing"}  ${note.noteId}  ${note.title ?? ""}`);
  }
  console.log(
    `billed: ${result.billingDetails?.billedDurationInMilliseconds ?? "?"} ms at ` +
      `${result.billingDetails?.billedMemoryUsedInMB ?? "?"} MB`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
