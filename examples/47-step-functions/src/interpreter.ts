// A model of how Step Functions walks a definition, for the states this chapter uses:
// Task, Choice, inline Map, Succeed, Fail, in JSONata. It is not the service.

import jsonata from "jsonata";

import type { Catcher, MapState, Retrier, StateGraph, TaskState, Template } from "./asl.ts";

/** An error under the name a Retry or Catch would match, such as "States.Timeout". */
export class TaskError extends Error {
  constructor(name: string, cause: string) {
    super(cause);
    this.name = name;
  }
}

// #region world
/** Everything outside the state machine: the services it calls, and whoever answers a task token. */
export type World = {
  /** One service call. `state` and `attempt` are there so a test can aim a fault. */
  call(
    resource: string,
    args: unknown,
    at: { state: string; attempt: number; token?: string },
  ): Promise<unknown>;
  /** What comes back for a task token: the output of SendTaskSuccess, or a thrown TaskError. */
  callback(token: string): Promise<unknown>;
};
// #endregion world

export type Step = { state: string; attempt: number; error?: string };
export type Resume = { state: string; input: unknown; variables: Record<string, unknown> };
export type Outcome = { steps: Step[]; waitedSeconds: number } & (
  | { status: "SUCCEEDED"; output: unknown }
  | {
      status: "FAILED";
      error: string;
      cause: string;
      /** Where a redrive would pick up. Absent after a Fail state, which only fails again. */
      resume?: Resume;
    }
);

export type Execution = {
  name: string;
  /** An ISO timestamp. The model has no clock of its own. */
  startTime: string;
  /** Jitter. Returns a number in [0, 1); the default takes the longest wait. */
  random?: () => number;
};

type Scope = Record<string, unknown>;
type Run = {
  execution: Execution;
  world: World;
  steps: Step[];
  waited: number;
  tokens: number;
};
type Frame = { map?: { Item: { Index: number; Value: unknown } } };
type Ended =
  | { kind: "output"; output: unknown }
  | { kind: "failed"; error: string; cause: string; resume?: Resume };

// #region matching
/** Whether an ErrorEquals list covers an error, by the rules of the error-handling page. */
export function matches(names: string[], error: string): boolean {
  if (names.includes(error)) {
    return true;
  }
  if (names.includes("States.ALL")) {
    return error !== "States.Runtime" && error !== "States.DataLimitExceeded";
  }
  return names.includes("States.TaskFailed") && error !== "States.Timeout";
}

/** The longest a retrier waits before retry number `retry` (1 for the first). */
export function retryDelay(retrier: Retrier, retry: number): number {
  const delay = (retrier.IntervalSeconds ?? 1) * (retrier.BackoffRate ?? 2) ** (retry - 1);
  return Math.min(delay, retrier.MaxDelaySeconds ?? Number.POSITIVE_INFINITY);
}
// #endregion matching

// #region evaluate
const EXPRESSION = /^\{% ([\s\S]+) %\}$/;

/** Evaluates every "{% ... %}" string in a template, with $states and the variables in reach. */
async function evaluate(
  template: Template,
  states: Record<string, unknown>,
  variables: Scope,
): Promise<unknown> {
  if (typeof template === "string") {
    const source = EXPRESSION.exec(template)?.[1];
    if (source === undefined) {
      return template;
    }
    let value: unknown;
    try {
      value = await jsonata(source).evaluate(undefined, { ...variables, states });
    } catch (thrown) {
      throw new TaskError(
        "States.QueryEvaluationError",
        `${source}: ${thrown instanceof Error ? thrown.message : JSON.stringify(thrown)}`,
      );
    }
    // JSON has no way to say "no value", so the service fails the state instead.
    if (value === undefined) {
      throw new TaskError("States.QueryEvaluationError", `${source} returned nothing`);
    }
    // jsonata marks its sequences with extra properties. A copy is plain JSON.
    return structuredClone(value);
  }
  if (Array.isArray(template)) {
    return Promise.all(template.map((item) => evaluate(item, states, variables)));
  }
  if (template !== null && typeof template === "object") {
    const entries = await Promise.all(
      Object.entries(template).map(
        async ([key, value]) => [key, await evaluate(value, states, variables)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return template;
}
// #endregion evaluate

// #region run
/**
 * Runs one execution to its end. `start` is where a redrive resumes: the failed
 * state, with the input and the variables it had.
 */
export async function runStateMachine(
  definition: StateGraph,
  input: unknown,
  world: World,
  execution: Execution,
  start?: Resume,
): Promise<Outcome> {
  const run: Run = { execution, world, steps: [], waited: 0, tokens: 0 };
  const ended = await walk(
    definition,
    start?.input ?? input,
    { ...start?.variables },
    run,
    {},
    start?.state ?? definition.StartAt,
  );
  const common = { steps: run.steps, waitedSeconds: run.waited };
  return ended.kind === "output"
    ? { ...common, status: "SUCCEEDED", output: ended.output }
    : {
        ...common,
        status: "FAILED",
        error: ended.error,
        cause: ended.cause,
        ...(ended.resume === undefined ? {} : { resume: ended.resume }),
      };
}

async function walk(
  graph: StateGraph,
  input: unknown,
  variables: Scope,
  run: Run,
  frame: Frame,
  startAt: string,
): Promise<Ended> {
  let name = startAt;
  let data = input;
  for (let visited = 0; visited < 10_000; visited++) {
    const state = graph.States[name];
    if (state === undefined) {
      throw new Error(`no state named ${name}`);
    }
    const context = (extra: Record<string, unknown> = {}) => ({
      Execution: { Name: run.execution.name, StartTime: run.execution.startTime },
      State: { Name: name },
      ...(frame.map === undefined ? {} : { Map: frame.map }),
      ...extra,
    });
    if (state.Type === "Fail") {
      run.steps.push({ state: name, attempt: 1 });
      return { kind: "failed", error: state.Error, cause: state.Cause };
    }
    if (state.Type === "Succeed") {
      run.steps.push({ state: name, attempt: 1 });
      const output =
        state.Output === undefined
          ? data
          : await evaluate(state.Output, { input: data, context: context() }, variables);
      return { kind: "output", output };
    }
    if (state.Type === "Choice") {
      run.steps.push({ state: name, attempt: 1 });
      let next = state.Default;
      for (const choice of state.Choices) {
        const states = { input: data, context: context() };
        if ((await evaluate(choice.Condition, states, variables)) === true) {
          next = choice.Next;
          break;
        }
      }
      name = next;
      continue;
    }
    const current = name;
    const attempt =
      state.Type === "Task"
        ? (number: number) => callTask(current, state, data, variables, run, context, number)
        : () => iterate(state, data, variables, run, context());
    const done = await withRetryAndCatch(current, state, data, variables, run, context, attempt);
    if (done.kind === "failed") {
      return {
        kind: "failed",
        error: done.error,
        cause: done.cause,
        resume: { state: current, input: data, variables },
      };
    }
    Object.assign(variables, done.assign);
    if (done.next === undefined) {
      return { kind: "output", output: done.output };
    }
    name = done.next;
    data = done.output;
  }
  throw new Error("more than 10,000 states visited: the definition loops");
}
// #endregion run

// #region retry-catch
type Done =
  | { kind: "next"; next: string | undefined; output: unknown; assign: Scope }
  | { kind: "failed"; error: string; cause: string };

/** One Task or Map state, through its retriers and then its catchers. */
async function withRetryAndCatch(
  name: string,
  state: TaskState | MapState,
  input: unknown,
  variables: Scope,
  run: Run,
  context: (extra?: Record<string, unknown>) => Record<string, unknown>,
  attempt: (number: number) => Promise<unknown>,
): Promise<Done> {
  // Each retrier counts its own retries, across every error it matched in this state.
  const used = new Map<Retrier, number>();
  for (let number = 1; ; number++) {
    try {
      const result = await attempt(number);
      run.steps.push({ state: name, attempt: number });
      const states = { input, result, context: context() };
      // Assign and Output are both worked out from the values the state was entered with.
      const [output, assign] = await Promise.all([
        evaluate(state.Output, states, variables),
        evaluate(("Assign" in state ? state.Assign : undefined) ?? {}, states, variables),
      ]);
      return { kind: "next", next: state.Next, output, assign: assign as Scope };
    } catch (thrown) {
      if (!(thrown instanceof TaskError)) {
        throw thrown;
      }
      run.steps.push({ state: name, attempt: number, error: thrown.name });
      const retrier = (state.Retry ?? []).find((item) => matches(item.ErrorEquals, thrown.name));
      const retries = retrier === undefined ? 0 : (used.get(retrier) ?? 0);
      if (retrier !== undefined && retries < (retrier.MaxAttempts ?? 3)) {
        used.set(retrier, retries + 1);
        const jitter =
          retrier.JitterStrategy === "FULL" ? (run.execution.random ?? (() => 1))() : 1;
        run.waited += retryDelay(retrier, retries + 1) * jitter;
        continue;
      }
      const errorOutput = { Error: thrown.name, Cause: thrown.message };
      const catcher: Catcher | undefined = (state.Catch ?? []).find((item) =>
        matches(item.ErrorEquals, thrown.name),
      );
      if (catcher === undefined) {
        return { kind: "failed", error: thrown.name, cause: thrown.message };
      }
      const states = { input, errorOutput, context: context() };
      return {
        kind: "next",
        next: catcher.Next,
        output:
          catcher.Output === undefined
            ? errorOutput
            : await evaluate(catcher.Output, states, variables),
        assign: (await evaluate(catcher.Assign ?? {}, states, variables)) as Scope,
      };
    }
  }
}
// #endregion retry-catch

// #region task
const WAIT_FOR_TOKEN = ".waitForTaskToken";

async function callTask(
  name: string,
  state: TaskState,
  input: unknown,
  variables: Scope,
  run: Run,
  context: (extra?: Record<string, unknown>) => Record<string, unknown>,
  attempt: number,
): Promise<unknown> {
  if (!state.Resource.endsWith(WAIT_FOR_TOKEN)) {
    const args = await evaluate(state.Arguments, { input, context: context() }, variables);
    return run.world.call(state.Resource, args, { state: name, attempt });
  }
  // Every attempt gets a token of its own; an answer to an earlier one is too late.
  const token = `token-${++run.tokens}`;
  const args = await evaluate(
    state.Arguments,
    { input, context: context({ Task: { Token: token } }) },
    variables,
  );
  const resource = state.Resource.slice(0, -WAIT_FOR_TOKEN.length);
  await run.world.call(resource, args, { state: name, attempt, token });
  // The call's own answer is dropped. The task's result is what the token comes back with.
  return run.world.callback(token);
}
// #endregion task

// #region map
/**
 * An inline Map: one walk of ItemProcessor per item. The model runs them one
 * after another, in order; the service runs up to MaxConcurrency at once.
 */
async function iterate(
  state: MapState,
  input: unknown,
  variables: Scope,
  run: Run,
  context: Record<string, unknown>,
): Promise<unknown> {
  const items = await evaluate(state.Items, { input, context }, variables);
  if (!Array.isArray(items)) {
    throw new TaskError("States.QueryEvaluationError", "Items did not evaluate to an array");
  }
  const results: unknown[] = [];
  for (const [index, value] of items.entries()) {
    const map = { Item: { Index: index, Value: value } };
    const item =
      state.ItemSelector === undefined
        ? value
        : await evaluate(
            state.ItemSelector,
            { input, context: { ...context, Map: map } },
            variables,
          );
    // An iteration reads the outer variables and keeps what it assigns to itself.
    const ended = await walk(
      state.ItemProcessor,
      item,
      { ...variables },
      run,
      { map },
      state.ItemProcessor.StartAt,
    );
    if (ended.kind === "failed") {
      // In inline mode one failed iteration fails the whole Map state.
      throw new TaskError(ended.error, ended.cause);
    }
    results.push(ended.output);
  }
  return results;
}
// #endregion map
