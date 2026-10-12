import { describe, expect, it } from "vite-plus/test";

import { checkLambdaTimeouts, MAX_VISIBILITY_SECONDS, nextExtension } from "../src/lease.ts";
import { CONSUMER, QUEUE } from "../src/settings.ts";

describe("the visibility timeout against the function's timeout", () => {
  it("this chapter's settings fit", () => {
    expect(
      checkLambdaTimeouts({
        visibilityTimeoutSeconds: QUEUE.visibilityTimeoutSeconds,
        functionTimeoutSeconds: CONSUMER.timeoutSeconds,
      }),
    ).toEqual([]);
  });

  it("names a function that may run longer than the queue lends a message", () => {
    const problems = checkLambdaTimeouts({
      visibilityTimeoutSeconds: 30,
      functionTimeoutSeconds: 60,
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("refuses to create the event source mapping");
  });

  it("counts the batch window into what the queue should allow", () => {
    expect(
      checkLambdaTimeouts({
        visibilityTimeoutSeconds: 60,
        functionTimeoutSeconds: 10,
        batchWindowSeconds: 5,
      }),
    ).toEqual([expect.stringContaining("under the recommended 65 s")]);
  });
});

describe("the next extension of a lease", () => {
  const receivedAtMs = 0;

  it("asks for what the consumer wants while there is room", () => {
    expect(nextExtension({ receivedAtMs, nowMs: 60_000, extendBySeconds: 120 })).toEqual({
      seconds: 120,
    });
  });

  it("asks for no more than what is left of the twelve hours", () => {
    const nowMs = (MAX_VISIBILITY_SECONDS - 30) * 1000;
    expect(nextExtension({ receivedAtMs, nowMs, extendBySeconds: 120 })).toEqual({ seconds: 30 });
  });

  it("gives up when the twelve hours are spent", () => {
    const nowMs = MAX_VISIBILITY_SECONDS * 1000;
    expect(nextExtension({ receivedAtMs, nowMs, extendBySeconds: 120 })).toBe("give_up");
  });
});
