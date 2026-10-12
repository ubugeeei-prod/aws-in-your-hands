import { describe, expect, it } from "vite-plus/test";

import { StillDenied, untilAllowed, untilDenied } from "../src/propagation.ts";

class Denied extends Error {}
const isDenied = (error: unknown) => error instanceof Denied;

/** Answers in a fixed order, the way different IAM endpoints might right after a change. */
function scripted<T>(answers: (T | Error)[]) {
  const calls = { count: 0, slept: [] as number[] };
  const next = async (): Promise<T> => {
    const answer = answers[Math.min(calls.count, answers.length - 1)] as T | Error;
    calls.count += 1;
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  const wait = (attempts: number) => ({
    attempts,
    delayMs: 2_000,
    sleep: async (ms: number) => void calls.slept.push(ms),
  });
  return { next, calls, wait };
}

describe("after granting a permission", () => {
  it("waits out denials that come before the grant has spread", async () => {
    const { next, calls, wait } = scripted([new Denied(), new Denied(), "ok"]);
    expect(await untilAllowed(next, isDenied, wait(10))).toEqual({ value: "ok", denials: 2 });
    expect(calls.slept).toEqual([2_000, 2_000]);
  });

  it("does not sleep when the first call is allowed", async () => {
    const { next, calls, wait } = scripted(["ok"]);
    await untilAllowed(next, isDenied, wait(10));
    expect(calls.slept).toEqual([]);
  });

  it("gives up after the budget and says so, instead of waiting forever on a wrong policy", async () => {
    const { next, calls, wait } = scripted<string>([new Denied()]);
    await expect(untilAllowed(next, isDenied, wait(5))).rejects.toBeInstanceOf(StillDenied);
    expect(calls.count).toBe(5);
  });

  it("does not retry an error that is not a denial", async () => {
    const { next, calls, wait } = scripted<string>([new Error("ResourceNotFoundException")]);
    await expect(untilAllowed(next, isDenied, wait(5))).rejects.toThrow(
      "ResourceNotFoundException",
    );
    expect(calls.count).toBe(1);
  });
});

describe("after removing a permission", () => {
  it("does not take the first denial as proof", async () => {
    // denied, then allowed again by an endpoint that has not caught up, then denied for good
    const { next, wait } = scripted<"allowed" | "denied">([
      "denied",
      "allowed",
      "denied",
      "denied",
      "denied",
    ]);
    expect(await untilDenied(next, 3, wait(10))).toEqual({
      confirmed: true,
      probes: 5,
      lastAllowedAt: 2,
    });
  });

  it("reports failure when the denials never line up", async () => {
    const { next, wait } = scripted<"allowed" | "denied">(["denied", "denied", "allowed"]);
    expect(await untilDenied(next, 3, wait(6))).toEqual({
      confirmed: false,
      probes: 6,
      lastAllowedAt: 6,
    });
  });
});
