import { describe, expect, it } from "vite-plus/test";

import type { StateGraph, TaskState } from "../src/asl.ts";
import { matches, retryDelay, runStateMachine, TaskError, type World } from "../src/interpreter.ts";
import { path } from "./harness.ts";

const EXECUTION = { name: "run-1", startTime: "2026-10-13T00:00:00.000Z" };

/** A world whose only service fails with the given errors, in order, then answers. */
function failing(errors: string[]): World {
  const queue = [...errors];
  return {
    call: async () => {
      const error = queue.shift();
      if (error !== undefined) {
        throw new TaskError(error, "injected");
      }
      return { ok: true };
    },
    callback: async () => ({}),
  };
}

const task = (fields: Partial<TaskState>): TaskState =>
  ({
    Type: "Task",
    Resource: "arn:aws:states:::sns:publish",
    Arguments: {},
    Output: "{% $states.input %}",
    TimeoutSeconds: 10,
    End: true,
    ...fields,
  }) as TaskState;

describe("Retry", () => {
  // The four failures of the error-handling page's "complex retry scenario".
  const scenario: StateGraph = {
    StartAt: "X",
    States: {
      X: task({
        Retry: [
          { ErrorEquals: ["ErrorA", "ErrorB"], IntervalSeconds: 1, BackoffRate: 2, MaxAttempts: 2 },
          { ErrorEquals: ["ErrorC"], IntervalSeconds: 5 },
        ],
        Catch: [{ ErrorEquals: ["States.ALL"], Next: "Z" }],
        Next: "Y",
      }),
      Y: { Type: "Succeed" },
      Z: { Type: "Fail", Error: "Caught", Cause: "the retriers gave up" },
    },
  };

  it("counts retries per retrier, across the errors it matched", async () => {
    const outcome = await runStateMachine(
      scenario,
      {},
      failing(["ErrorA", "ErrorB", "ErrorC", "ErrorB"]),
      EXECUTION,
    );
    expect(path(outcome)).toEqual(["X!ErrorA", "X!ErrorB", "X!ErrorC", "X!ErrorB", "Z"]);
    // Waits of one and two seconds from the first retrier, five from the second.
    expect(outcome.waitedSeconds).toBe(8);
    expect(outcome).toMatchObject({ status: "FAILED", error: "Caught" });
  });

  it("grows the wait by BackoffRate and stops it at MaxDelaySeconds", () => {
    const retrier = { ErrorEquals: ["States.Timeout"], IntervalSeconds: 3, BackoffRate: 2 };
    expect([1, 2, 3].map((retry) => retryDelay(retrier, retry))).toEqual([3, 6, 12]);
    const capped = { ...retrier, MaxDelaySeconds: 5 };
    expect([1, 2, 3].map((retry) => retryDelay(capped, retry))).toEqual([3, 5, 5]);
    expect(retryDelay({ ErrorEquals: ["States.ALL"] }, 3)).toBe(4);
  });

  it("spreads the wait between zero and the full delay under FULL jitter", async () => {
    const graph: StateGraph = {
      StartAt: "X",
      States: {
        X: task({
          Retry: [{ ErrorEquals: ["States.ALL"], IntervalSeconds: 4, JitterStrategy: "FULL" }],
        }),
      },
    };
    const run = (random?: () => number) =>
      runStateMachine(graph, {}, failing(["E", "E"]), {
        ...EXECUTION,
        ...(random && { random }),
      });
    // 4 s, then 8 s: the longest it can be, half of it, none of it.
    expect((await run()).waitedSeconds).toBe(12);
    expect((await run(() => 0.5)).waitedSeconds).toBe(6);
    expect((await run(() => 0)).waitedSeconds).toBe(0);
  });

  it("does not retry when MaxAttempts is 0, and fails the execution without a catcher", async () => {
    const graph: StateGraph = {
      StartAt: "X",
      States: {
        X: task({
          Retry: [{ ErrorEquals: ["Refused"], MaxAttempts: 0 }, { ErrorEquals: ["States.ALL"] }],
        }),
      },
    };
    const outcome = await runStateMachine(graph, { n: 1 }, failing(["Refused"]), EXECUTION);
    expect(path(outcome)).toEqual(["X!Refused"]);
    expect(outcome).toMatchObject({
      status: "FAILED",
      error: "Refused",
      resume: { state: "X", input: { n: 1 } },
    });
  });
});

describe("error names", () => {
  it("lets States.TaskFailed match everything but a timeout", () => {
    expect(matches(["States.TaskFailed"], "DynamoDB.ConditionalCheckFailedException")).toBe(true);
    expect(matches(["States.TaskFailed"], "States.Timeout")).toBe(false);
  });

  it("keeps the two terminal errors out of States.ALL unless they are named", () => {
    expect(matches(["States.ALL"], "States.Timeout")).toBe(true);
    expect(matches(["States.ALL"], "States.Runtime")).toBe(false);
    expect(matches(["States.ALL"], "States.DataLimitExceeded")).toBe(false);
    expect(matches(["States.DataLimitExceeded"], "States.DataLimitExceeded")).toBe(true);
  });
});

describe("data", () => {
  it("fails a state whose expression has no value", async () => {
    const graph: StateGraph = {
      StartAt: "X",
      States: { X: task({ Output: { title: "{% $states.input.missing %}" } }) },
    };
    const outcome = await runStateMachine(graph, {}, failing([]), EXECUTION);
    expect(outcome).toMatchObject({ status: "FAILED", error: "States.QueryEvaluationError" });
  });

  it("hands a catcher's next state the error output, or what Output makes of it", async () => {
    const graph = (output?: string): StateGraph => ({
      StartAt: "X",
      States: {
        X: task({
          Catch: [{ ErrorEquals: ["States.ALL"], ...(output && { Output: output }), Next: "Y" }],
        }),
        Y: { Type: "Succeed" },
      },
    });
    const bare = await runStateMachine(graph(), { n: 1 }, failing(["Boom"]), EXECUTION);
    expect(bare).toMatchObject({ output: { Error: "Boom", Cause: "injected" } });
    const merged = await runStateMachine(
      graph("{% $merge([$states.input, {'failure': $states.errorOutput.Error}]) %}"),
      { n: 1 },
      failing(["Boom"]),
      EXECUTION,
    );
    expect(merged).toMatchObject({ output: { n: 1, failure: "Boom" } });
  });

  it("works out every Assign from the values the state was entered with", async () => {
    // The variables page's example: x = 3 and a = 6 become x = 6 and nextX = 3.
    const graph: StateGraph = {
      StartAt: "Set",
      States: {
        Set: task({ Assign: { x: 3, a: 6 }, Next: "Swap" }),
        Swap: task({ Assign: { x: "{% $a %}", nextX: "{% $x %}" }, Next: "Read" }),
        Read: task({ Output: { x: "{% $x %}", nextX: "{% $nextX %}" } }),
      },
    };
    const outcome = await runStateMachine(graph, {}, failing([]), EXECUTION);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", output: { x: 6, nextX: 3 } });
  });

  it("gives each attempt of a callback task a token of its own", async () => {
    const tokens: string[] = [];
    const world: World = {
      call: async (_resource, args) => {
        tokens.push((args as { token: string }).token);
        return {};
      },
      callback: async (token) => {
        if (token === tokens[0]) {
          throw new TaskError("States.Timeout", "no heartbeat");
        }
        return { answeredTo: token };
      },
    };
    const graph: StateGraph = {
      StartAt: "Ask",
      States: {
        Ask: task({
          Resource: "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
          Arguments: { token: "{% $states.context.Task.Token %}" },
          Output: "{% $states.result %}",
          Retry: [{ ErrorEquals: ["States.Timeout"], MaxAttempts: 1 }],
        }),
      },
    };
    const outcome = await runStateMachine(graph, {}, world, EXECUTION);
    expect(new Set(tokens).size).toBe(2);
    expect(outcome).toMatchObject({ status: "SUCCEEDED", output: { answeredTo: tokens[1] } });
  });
});

describe("Map", () => {
  const each = (processor: TaskState): StateGraph => ({
    StartAt: "Each",
    States: {
      Each: {
        Type: "Map",
        Items: "{% $states.input.items %}",
        ItemSelector: {
          index: "{% $states.context.Map.Item.Index %}",
          value: "{% $states.context.Map.Item.Value %}",
        },
        MaxConcurrency: 1,
        ItemProcessor: {
          ProcessorConfig: { Mode: "INLINE" },
          StartAt: "One",
          States: { One: processor },
        },
        Output: "{% $states.result %}",
        End: true,
      },
    },
  });

  it("hands each iteration its item and returns the outputs in order", async () => {
    const outcome = await runStateMachine(
      each(task({ Output: "{% $states.input.value & '@' & $states.input.index %}" })),
      { items: ["a", "b", "c"] },
      failing([]),
      EXECUTION,
    );
    expect(outcome).toMatchObject({ status: "SUCCEEDED", output: ["a@0", "b@1", "c@2"] });
  });

  it("fails as a whole when one iteration fails", async () => {
    const outcome = await runStateMachine(
      each(task({})),
      { items: ["a", "b"] },
      failing(["Boom"]),
      EXECUTION,
    );
    expect(path(outcome)).toEqual(["One!Boom", "Each!Boom"]);
    expect(outcome).toMatchObject({ status: "FAILED", error: "Boom", resume: { state: "Each" } });
  });
});
