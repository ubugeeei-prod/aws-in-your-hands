import * as v from "valibot";

import type { AssistantEvent } from "./contract.ts";
import { type Usage, usageSchema } from "./usage.ts";

// #region case
export const evalCaseSchema = v.object({
  id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)),
  why: v.string(),
  /** The transcript the scripted model plays for this case. The real model ignores it. */
  transcript: v.string(),
  question: v.string(),
  expect: v.object({
    complete: v.boolean(),
    /** Facts the answer has to state, each as a piece of text it must contain. */
    mustContain: v.array(v.string()),
    /** Text the answer must not contain: another owner's data, an injected phrase. */
    mustNotContain: v.array(v.string()),
    /** Tools that must have run, in any order. */
    tools: v.array(v.string()),
    maxTurns: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
});
export type EvalCase = v.InferOutput<typeof evalCaseSchema>;
export const evalSuiteSchema = v.object({ source: v.string(), cases: v.array(evalCaseSchema) });
// #endregion case

// #region observe
export type Observed = {
  text: string;
  tools: string[];
  /** The event that ended the stream, if one did. */
  last: AssistantEvent | undefined;
};

export async function observe(events: AsyncIterable<AssistantEvent>): Promise<Observed> {
  let text = "";
  const tools: string[] = [];
  let last: AssistantEvent | undefined;
  for await (const event of events) {
    last = event;
    if (event.type === "delta") {
      text += event.text;
    } else if (event.type === "blocked") {
      text = event.text;
    } else if (event.type === "tool" && event.ok) {
      tools.push(event.name);
    }
  }
  return { text, tools, last };
}
// #endregion observe

// #region check
/** Every way the outcome misses what the case expects. Empty means it passed. */
export function check(expect: EvalCase["expect"], observed: Observed): string[] {
  const problems: string[] = [];
  const { last } = observed;
  if (last === undefined || (last.type !== "done" && last.type !== "error")) {
    return ["the stream ended without `done` or `error`"];
  }
  const complete = last.type === "done" && last.complete;
  if (complete !== expect.complete) {
    const how = last.type === "done" ? last.stopReason : last.code;
    problems.push(`expected complete=${expect.complete}, ended with ${how}`);
  }
  if (last.turns > expect.maxTurns) {
    problems.push(`took ${last.turns} turns, at most ${expect.maxTurns} expected`);
  }
  for (const fact of expect.mustContain) {
    if (!observed.text.includes(fact)) {
      problems.push(`the answer does not contain "${fact}"`);
    }
  }
  for (const text of expect.mustNotContain) {
    if (observed.text.includes(text)) {
      problems.push(`the answer contains "${text}"`);
    }
  }
  for (const tool of expect.tools) {
    if (!observed.tools.includes(tool)) {
      problems.push(`the tool ${tool} did not run`);
    }
  }
  return problems;
}
// #endregion check

// #region suite
export type CaseResult = { id: string; problems: string[]; usage: Usage | null };
export type SuiteResult = { passed: number; failed: number; results: CaseResult[] };

/** Runs every case once. `ask` is the assistant with its model and tools already chosen. */
export async function runSuite(
  cases: EvalCase[],
  ask: (testCase: EvalCase) => AsyncIterable<AssistantEvent>,
): Promise<SuiteResult> {
  const results: CaseResult[] = [];
  for (const testCase of cases) {
    const observed = await observe(ask(testCase));
    const usage = v.safeParse(
      usageSchema,
      observed.last && "usage" in observed.last ? observed.last.usage : null,
    );
    results.push({
      id: testCase.id,
      problems: check(testCase.expect, observed),
      usage: usage.success ? usage.output : null,
    });
  }
  const failed = results.filter((result) => result.problems.length > 0).length;
  return { passed: results.length - failed, failed, results };
}
// #endregion suite
