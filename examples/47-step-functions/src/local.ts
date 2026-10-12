import { noteDigestWorkflow } from "./digest.ts";
import { type Outcome, type Resume, runStateMachine } from "./interpreter.ts";
import type { LocalWorld } from "./local-world.ts";
import { executionName, type ImportInput, importNoteWorkflow } from "./saga.ts";

/** Plain names where the stack puts a table name, a bucket name, a queue URL, and a topic ARN. */
export const LOCAL = {
  tableName: "notes",
  bucketName: "local-bucket",
  queueUrl: "local://scan-queue",
  topicArn: "local:imports",
};
export const localImport = importNoteWorkflow(LOCAL);
export const localDigest = noteDigestWorkflow(LOCAL);

const START_TIME = "2026-10-13T00:00:00.000Z";

/** One import against a local world. `resume` is what a redrive would do. */
export const runImport = (
  world: LocalWorld,
  input: ImportInput,
  resume?: Resume,
): Promise<Outcome> =>
  runStateMachine(
    localImport,
    input,
    world,
    { name: executionName(input), startTime: START_TIME },
    resume,
  );
