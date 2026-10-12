import type { StateMachine, TaskState } from "./workflow.ts";

/** Calls the thing a Task state names. Throwing fails the attempt. */
export type Invoke = (resource: string, input: unknown) => Promise<unknown>;

/** An error with a name of the caller's choosing, such as "States.Timeout". */
export class TaskError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export type Step = { state: string; attempt: number; error?: string };
export type Outcome =
  | { status: "SUCCEEDED"; output: unknown; steps: Step[] }
  | {
      status: "FAILED";
      error: string;
      cause: string;
      steps: Step[];
      /** Where a redrive would pick up: the failed state and the input it had. Absent after a Fail state. */
      resume?: { state: string; input: unknown };
    };

const matches = (names: string[], error: string): boolean =>
  names.includes("States.ALL") ||
  (names.includes("States.TaskFailed") && error !== "States.Timeout") ||
  names.includes(error);

const field = (path: `$.${string}`): string => path.slice(2);

// #region run
/**
 * Walks the definition the way this chapter needs: Task with Retry and Catch,
 * Choice on one boolean, Succeed, Fail. It waits for nothing and persists
 * nothing; it is here so the wiring can be run and broken on a laptop.
 */
export async function runWorkflow(
  definition: StateMachine,
  input: unknown,
  invoke: Invoke,
  start: { state: string } = { state: definition.StartAt },
): Promise<Outcome> {
  const steps: Step[] = [];
  let name = start.state;
  let data = input;
  for (let visited = 0; visited < 10_000; visited++) {
    const state = definition.States[name];
    if (state === undefined) {
      throw new Error(`no state named ${name}`);
    }
    if (state.Type === "Succeed") {
      return { status: "SUCCEEDED", output: data, steps };
    }
    if (state.Type === "Fail") {
      return { status: "FAILED", error: state.Error, cause: state.Cause, steps };
    }
    if (state.Type === "Choice") {
      const record = data as Record<string, unknown>;
      name =
        state.Choices.find((choice) => record[field(choice.Variable)] === choice.BooleanEquals)
          ?.Next ?? state.Default;
      continue;
    }
    const result = await runTask(name, state, data, invoke, steps);
    if (result.kind === "failed") {
      return { status: "FAILED", ...result.failure, steps, resume: { state: name, input: data } };
    }
    name = result.next;
    data = result.output;
  }
  throw new Error("more than 10,000 states visited: the definition loops");
}
// #endregion run

// #region task
type TaskResult =
  | { kind: "next"; next: string; output: unknown }
  | { kind: "failed"; failure: { error: string; cause: string } };

async function runTask(
  name: string,
  state: TaskState,
  input: unknown,
  invoke: Invoke,
  steps: Step[],
): Promise<TaskResult> {
  // Each retrier counts its own attempts, as in Step Functions.
  const used = new Map<number, number>();
  for (let attempt = 1; ; attempt++) {
    try {
      const output = await invoke(state.Resource, input);
      steps.push({ state: name, attempt });
      return { kind: "next", next: state.Next, output };
    } catch (thrown) {
      // A Lambda function's error reaches Step Functions under the error's `name`.
      const error = thrown instanceof Error ? thrown.name : "Error";
      const cause = thrown instanceof Error ? thrown.message : String(thrown);
      steps.push({ state: name, attempt, error });
      const index = (state.Retry ?? []).findIndex((retrier) => matches(retrier.ErrorEquals, error));
      const retrier = state.Retry?.[index];
      if (retrier !== undefined && (used.get(index) ?? 0) < (retrier.MaxAttempts ?? 3)) {
        used.set(index, (used.get(index) ?? 0) + 1);
        continue;
      }
      const catcher = (state.Catch ?? []).find((candidate) =>
        matches(candidate.ErrorEquals, error),
      );
      if (catcher === undefined) {
        return { kind: "failed", failure: { error, cause } };
      }
      // ResultPath keeps the state's input and adds the error beside it.
      const output = {
        ...(input as object),
        [field(catcher.ResultPath)]: { Error: error, Cause: cause },
      };
      return { kind: "next", next: catcher.Next, output };
    }
  }
}
// #endregion task
