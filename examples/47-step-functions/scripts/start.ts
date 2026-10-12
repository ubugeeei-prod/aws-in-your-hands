// vp run sfn:start [--owner user-1] [--note-id note-1] [--title Minutes]    starts one import (changes AWS)
//   node scripts/start.ts ...
//
// Puts a small file in the inbox, then starts the import under a name made
// from the owner and the note ID. Starting the same import again while it
// runs returns the same execution; once it has closed, Step Functions answers
// ExecutionAlreadyExists.

import { parseArgs } from "node:util";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { executionName, importInputSchema } from "../src/saga.ts";

const STACK = "AihStepFunctions";
const { values } = parseArgs({
  options: {
    owner: { type: "string", default: "user-1" },
    "note-id": { type: "string", default: "note-1" },
    title: { type: "string", default: "Minutes" },
  },
});

try {
  // Checked with the same schema the tests use, before anything is written.
  const input = v.parse(importInputSchema, {
    owner: values.owner,
    noteId: values["note-id"],
    title: values.title,
    body: "Imported by vp run sfn:start",
    upload: `inbox/${values.owner}/${values["note-id"]}.txt`,
  });
  const { target } = await preflight({
    access: "mutate",
    action: `start the import of ${input.noteId}`,
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  await new S3Client({ region: target.region }).send(
    new PutObjectCommand({
      Bucket: requireOutput(outputs, "FilesBucketName"),
      Key: input.upload,
      Body: "a file to attach",
      ContentType: "text/plain",
    }),
  );
  const started = await new SFNClient({ region: target.region }).send(
    new StartExecutionCommand({
      stateMachineArn: requireOutput(outputs, "ImportNoteArn"),
      name: executionName(input),
      input: JSON.stringify(input),
    }),
  );
  console.log(`execution: ${started.executionArn}`);
  console.log("It now waits for the scan. Answer with `vp run sfn:callback --verdict clean`.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
