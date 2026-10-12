import { describe, expect, it } from "vite-plus/test";

import { billedRequests, emptyReceivesPerMonth, kmsRequestsPerMonth } from "../src/cost.ts";

// The numbers the cost page quotes.
describe("what a request is, on the bill", () => {
  it("counts a payload in chunks of 64 KB", () => {
    expect(billedRequests(1)).toBe(1);
    expect(billedRequests(64 * 1024)).toBe(1);
    expect(billedRequests(64 * 1024 + 1)).toBe(2);
    // The pricing page's own example: 1 MiB is 16 requests.
    expect(billedRequests(1_048_576)).toBe(16);
  });

  it("counts the receives of one consumer waiting on an empty queue for a month", () => {
    expect(emptyReceivesPerMonth(1, 20)).toBe(131_400);
    // Short polling once a second, for comparison.
    expect(emptyReceivesPerMonth(1, 1)).toBe(2_628_000);
  });

  it("counts the calls to KMS for one producer and one consumer at the default reuse period", () => {
    expect(kmsRequestsPerMonth({ dataKeyReuseSeconds: 300, producers: 1, consumers: 1 })).toBe(
      26_280,
    );
  });
});
