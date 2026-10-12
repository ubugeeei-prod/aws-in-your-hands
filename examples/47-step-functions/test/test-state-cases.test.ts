import { describe, expect, it } from "vite-plus/test";

import { runStateMachine, TaskError, type World } from "../src/interpreter.ts";
import { localImport } from "../src/local.ts";
import { TEST_STATE_CASES, type TestStateCase } from "../src/test-state-cases.ts";

/** What the local model does with the case, in TestState's words. */
async function localVerdict(testCase: TestStateCase): Promise<TestStateCase["expected"]> {
  const { mock, state } = testCase;
  const world: World = {
    call: async () => {
      if ("error" in mock) {
        throw new TaskError(mock.error, mock.cause);
      }
      return mock.result;
    },
    callback: async () => ("result" in mock ? mock.result : {}),
  };
  const outcome = await runStateMachine(
    localImport,
    testCase.input,
    world,
    { name: "import-user-1-note-1", startTime: "2026-10-13T00:00:00.000Z" },
    { state, input: testCase.input, variables: {} },
  );
  const attempts = outcome.steps.filter((step) => step.state === state);
  const next = outcome.steps[attempts.length]?.state;
  if (!("error" in mock)) {
    return { status: "SUCCEEDED", ...(next !== undefined && { nextState: next }) };
  }
  // TestState answers for one attempt. The model ran them all, so count what was left to run.
  if (attempts.length - 1 > (testCase.retries ?? 0)) {
    return { status: "RETRIABLE" };
  }
  return next === undefined ? { status: "FAILED" } : { status: "CAUGHT_ERROR", nextState: next };
}

describe("the cases sent to TestState", () => {
  for (const testCase of TEST_STATE_CASES) {
    it(`the local model agrees: ${testCase.name}`, async () => {
      expect(await localVerdict(testCase)).toEqual(testCase.expected);
    });
  }
});
