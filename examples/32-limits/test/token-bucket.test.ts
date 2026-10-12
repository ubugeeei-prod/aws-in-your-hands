import { describe, expect, it } from "vite-plus/test";

import { type BucketPolicy, fullBucket, take } from "../src/token-bucket.ts";

const policy: BucketPolicy = { ratePerSecond: 10, burst: 20 };

/** Sends `count` requests at the same instant and reports how many passed. */
function burst(state: ReturnType<typeof fullBucket>, count: number, now: number) {
  let allowed = 0;
  for (let index = 0; index < count; index++) {
    const taken = take(state, policy, now);
    state = taken.state;
    allowed += Number(taken.allowed);
  }
  return { state, allowed };
}

describe("token bucket", () => {
  it("lets a burst through after a quiet spell, and no more than the burst", () => {
    expect(burst(fullBucket(policy, 0), 50, 0).allowed).toBe(20);
  });

  it("then lets through only the rate, however many ask", () => {
    let { state } = burst(fullBucket(policy, 0), 50, 0);
    let allowed = 0;
    // 100 requests a second for 3 seconds, against a rate of 10.
    for (let now = 10; now <= 3000; now += 10) {
      const taken = take(state, policy, now);
      state = taken.state;
      allowed += Number(taken.allowed);
    }
    expect(allowed).toBe(30);
  });

  it("never saves up more than the burst, however long nobody calls", () => {
    const { state } = burst(fullBucket(policy, 0), 50, 0);
    expect(burst(state, 50, 3_600_000).allowed).toBe(20);
  });

  it("says how long until the next token", () => {
    const { state } = burst(fullBucket(policy, 0), 20, 0);
    const refused = take(state, policy, 0);
    expect(refused).toMatchObject({ allowed: false, retryAfterMs: 100 });
    expect(take(refused.state, policy, 99).allowed).toBe(false);
    expect(take(refused.state, policy, 100).allowed).toBe(true);
  });

  it("is not drained by a clock that steps back", () => {
    const { state } = burst(fullBucket(policy, 1000), 5, 1000);
    expect(take(state, policy, 0).state.milliTokens).toBe(14_000);
  });
});
