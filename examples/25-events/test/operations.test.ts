import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { describeDeadLetter } from "../src/dead-letter.ts";
import { planReplay } from "../src/replay-plan.ts";

const now = new Date("2026-10-12T12:00:00.000Z");

describe("planning a replay", () => {
  it("covers the minutes asked for, up to now, for the rules named", () => {
    expect(planReplay({ minutes: "60", rule: ["timeline", "timeline"] }, now)).toEqual({
      name: "replay-20261012120000",
      from: new Date("2026-10-12T11:00:00.000Z"),
      to: now,
      rules: ["timeline"],
      warnings: [],
    });
  });

  it("says when a replay includes the rule that lets no replayed event through", () => {
    const everything = planReplay({ minutes: "60" }, now);
    expect(everything.rules).toEqual([]);
    expect(everything.warnings).toEqual([expect.stringContaining("rejections")]);
    expect(planReplay({ minutes: "60", rule: ["rejections"] }, now).warnings).toHaveLength(1);
    expect(planReplay({ minutes: "60", rule: ["counter"] }, now).warnings).toEqual([]);
  });

  it("warns about a window the archive may not have caught up with", () => {
    expect(planReplay({ minutes: "5", rule: ["counter"] }, now).warnings).toEqual([
      expect.stringContaining("10 minutes"),
    ]);
  });

  it("refuses a window older than the archive keeps", () => {
    expect(() => planReplay({ minutes: String(7 * 24 * 60 + 1) }, now)).toThrow(/7 days/);
    expect(planReplay({ minutes: String(7 * 24 * 60), rule: ["counter"] }, now).from).toEqual(
      new Date("2026-10-05T12:00:00.000Z"),
    );
  });

  it("refuses a rule that does not exist, a window of no length, and a name EventBridge would not take", () => {
    expect(() => planReplay({ minutes: "60", rule: ["naive-counter"] }, now)).toThrow(v.ValiError);
    for (const minutes of ["0", "-5", "soon", "1.5"]) {
      expect(() => planReplay({ minutes }, now)).toThrow(v.ValiError);
    }
    expect(() => planReplay({}, now)).toThrow(v.ValiError);
    expect(() => planReplay({ minutes: "60", name: "has spaces" }, now)).toThrow(v.ValiError);
  });
});

describe("reading a dead letter", () => {
  const event = JSON.stringify({ "detail-type": "NoteCreated", detail: { id: "x" } });

  it("a rule that could not deliver names itself and the error", () => {
    expect(
      describeDeadLetter(
        {
          RULE_ARN: "arn:aws:events:ap-northeast-1:111122223333:rule/aih-events/TimelineRule-abc",
          ERROR_CODE: "NO_PERMISSIONS",
        },
        event,
      ),
    ).toBe("rule TimelineRule-abc could not deliver: NO_PERMISSIONS");
  });

  it("a function that failed comes wrapped in Lambda's record of the attempts", () => {
    const record = JSON.stringify({
      version: "1.0",
      requestContext: { condition: "RetriesExhausted", approximateInvokeCount: 3 },
      requestPayload: JSON.parse(event),
    });
    expect(describeDeadLetter({}, record)).toBe(
      "the timeline function failed 3 times (RetriesExhausted)",
    );
  });

  it("a message moved from the counter's queue is the event itself", () => {
    expect(describeDeadLetter({}, event)).toBe(
      "the counter did not accept a NoteCreated event in five receives",
    );
  });

  it("anything else is taken to be from the pipe", () => {
    expect(describeDeadLetter({}, "not json")).toContain("from the pipe");
    expect(describeDeadLetter({}, JSON.stringify({ context: {} }))).toContain("from the pipe");
  });
});
