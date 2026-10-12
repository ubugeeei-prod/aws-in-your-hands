// vp run sfn:test-state    asks the TestState API what single states of the import do (calls AWS, changes nothing)
//   node scripts/test-state.ts
//
// Each case is sent with a mocked service answer, so Step Functions evaluates
// the state itself (its JSONata, Retry and Catch) and calls nothing. No stack
// is needed. The answers are compared with the table the unit tests hold the
// local model to: a mismatch is a place where the model is wrong.

import { SFNClient, TestStateCommand } from "@aws-sdk/client-sfn";

import { preflight } from "@aih/tools/aws/preflight.ts";

import { localImport } from "../src/local.ts";
import { TEST_STATE_CASES } from "../src/test-state-cases.ts";

try {
  const { target } = await preflight({ access: "observe", action: "test single states" });
  const sfn = new SFNClient({ region: target.region });
  let mismatches = 0;
  for (const testCase of TEST_STATE_CASES) {
    const { mock } = testCase;
    const isTask = localImport.States[testCase.state]?.Type === "Task";
    const answer = await sfn.send(
      new TestStateCommand({
        definition: JSON.stringify(localImport),
        stateName: testCase.state,
        input: JSON.stringify(testCase.input),
        // Only a Task, Map or Parallel state may be given a mock, and a context needs one.
        ...(isTask && {
          mock:
            "error" in mock
              ? { errorOutput: { error: mock.error, cause: mock.cause } }
              : // The mocked results are not full service responses, so their shape is not checked.
                { result: JSON.stringify(mock.result), fieldValidationMode: "NONE" as const },
          context: JSON.stringify({
            Execution: { Name: "import-user-1-note-1", StartTime: "2026-10-13T00:00:00.000Z" },
            Task: { Token: "token-1" },
          }),
        }),
        ...(testCase.retries !== undefined && {
          stateConfiguration: { retrierRetryCount: testCase.retries },
        }),
      }),
    );
    const agrees =
      answer.status === testCase.expected.status &&
      (answer.nextState ?? undefined) === testCase.expected.nextState;
    mismatches += agrees ? 0 : 1;
    console.log(
      `${agrees ? "same     " : "DIFFERENT"}  ${testCase.state}: ${testCase.name}\n` +
        `           TestState: ${answer.status} ${answer.nextState ?? ""} ${answer.error ?? ""}`,
    );
  }
  process.exit(mismatches === 0 ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}
