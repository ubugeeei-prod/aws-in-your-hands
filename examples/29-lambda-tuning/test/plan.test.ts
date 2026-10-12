import { describe, expect, it } from "vite-plus/test";

import { invocationItems, provisionedItems } from "../src/plan.ts";

describe("the lines handed to the pricing calculator", () => {
  it("price a month of invocations as requests plus GB-seconds", () => {
    expect(invocationItems({ memoryMb: 256, billedMs: 50, invocations: 1_000_000 })).toEqual([
      { priceId: "lambda.request.arm", quantity: 1_000_000, basis: "1000000 invocations" },
      {
        priceId: "lambda.duration.arm",
        quantity: 12_500,
        basis: "1000000 x 50 ms x 256 MB, in GB-seconds",
      },
    ]);
  });

  it("price provisioned concurrency by the month, not by use", () => {
    expect(provisionedItems({ memoryMb: 256, concurrency: 1 })).toEqual([
      {
        priceId: "lambda.provisioned.arm",
        quantity: 657_000,
        basis: "1 x 256 MB x 2,628,000 s, in GB-seconds",
      },
    ]);
  });
});
