import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import suite from "../fixtures/eval/cases.json" with { type: "json" };
import { check, evalSuiteSchema, type Observed, runSuite } from "../src/eval.ts";
import { type TranscriptName, transcriptNames } from "../src/transcripts.ts";
import { NO_USAGE } from "../src/usage.ts";
import { ALICE, never, setup, toolsFor } from "./helpers.ts";

const { cases } = v.parse(evalSuiteSchema, suite);
const isTranscript = (name: string): name is TranscriptName =>
  (transcriptNames as readonly string[]).includes(name);

describe("the regression suite, against the scripted model", () => {
  it("passes every case", async () => {
    const tools = await toolsFor(ALICE);
    const result = await runSuite(cases, (testCase) => {
      if (!isTranscript(testCase.transcript)) {
        throw new Error(`no transcript named ${testCase.transcript}`);
      }
      return setup(testCase.transcript).assistant(testCase.question, tools, never);
    });
    expect(result.results.filter((one) => one.problems.length > 0)).toEqual([]);
    expect(result).toMatchObject({ passed: cases.length, failed: 0 });
  });

  it("fails a case when the answer played to it is the wrong one", async () => {
    const tools = await toolsFor(ALICE);
    const facts = cases.filter((testCase) => testCase.id === "release-facts");
    const result = await runSuite(facts, (testCase) =>
      setup("answer-direct").assistant(testCase.question, tools, never),
    );
    expect(result.failed).toBe(1);
    expect(result.results[0]?.problems).toContain('the answer does not contain "決済"');
    expect(result.results[0]?.problems).toContain("the tool read_note did not run");
  });
});

describe("check", () => {
  const expectation = {
    complete: true,
    mustContain: ["負荷試験"],
    mustNotContain: ["720"],
    tools: [],
    maxTurns: 2,
  };
  const done = (overrides: Partial<Observed> = {}): Observed => ({
    text: "負荷試験が残っています。",
    tools: [],
    last: { type: "done", stopReason: "end_turn", complete: true, turns: 1, usage: NO_USAGE },
    ...overrides,
  });

  it("passes an answer with the fact, without the forbidden text, within the turns", () => {
    expect(check(expectation, done())).toEqual([]);
  });

  it("names each thing that is wrong", () => {
    expect(check(expectation, done({ text: "基本給は 720 万円です。" }))).toEqual([
      'the answer does not contain "負荷試験"',
      'the answer contains "720"',
    ]);
    const slow = done({
      last: { type: "done", stopReason: "turn_limit", complete: false, turns: 4, usage: NO_USAGE },
    });
    expect(check(expectation, slow)).toEqual([
      "expected complete=true, ended with turn_limit",
      "took 4 turns, at most 2 expected",
    ]);
  });

  it("fails a stream that ended without saying how", () => {
    expect(check(expectation, done({ last: { type: "delta", text: "負荷試験" } }))).toEqual([
      "the stream ended without `done` or `error`",
    ]);
    expect(check(expectation, done({ last: undefined }))).toHaveLength(1);
  });
});
