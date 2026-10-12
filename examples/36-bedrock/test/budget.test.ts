import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { InMemoryUsageLedger, utcDay } from "../src/budget.ts";
import { DynamoDbUsageLedger } from "../src/dynamodb-ledger.ts";
import { modelProfiles } from "../src/models.ts";
import {
  addUsage,
  breakEvenCalls,
  ceilingMicroUsd,
  costMicroUsd,
  NO_USAGE,
  prefixCostMicroUsd,
  totalTokens,
} from "../src/usage.ts";
import { HAIKU, NOVA } from "./helpers.ts";

const nova = modelProfiles[NOVA].usdPerMillionTokens;
const haiku = modelProfiles[HAIKU].usdPerMillionTokens;

describe("cost", () => {
  it("prices each kind of token at its own rate, in millionths of a dollar", () => {
    const usage = {
      inputTokens: 1240,
      outputTokens: 91,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
    };
    // 1240 x 0.396 + 91 x 3.311 = 491.04 + 301.301
    expect(costMicroUsd(usage, nova)).toBe(793);
    const cached = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadInputTokens: 5000,
      cacheWriteInputTokens: 5000,
    };
    // 100 x 1.1 + 50 x 5.5 + 5000 x 0.11 + 5000 x 1.375
    expect(costMicroUsd(cached, haiku)).toBe(110 + 275 + 550 + 6875);
  });

  it("sets aside more than any use of that many tokens can cost", () => {
    for (const prices of [nova, haiku]) {
      const ceiling = ceilingMicroUsd(20_000, prices);
      for (const usage of [
        { ...NO_USAGE, outputTokens: 20_000 },
        { ...NO_USAGE, inputTokens: 20_000 },
        { ...NO_USAGE, cacheWriteInputTokens: 20_000 },
        {
          inputTokens: 5000,
          outputTokens: 5000,
          cacheReadInputTokens: 5000,
          cacheWriteInputTokens: 5000,
        },
      ]) {
        expect(totalTokens(usage)).toBe(20_000);
        expect(costMicroUsd(usage, prices)).toBeLessThanOrEqual(ceiling);
      }
    }
    expect(ceilingMicroUsd(20_000, nova)).toBe(66_220);
  });

  it("adds usage field by field", () => {
    const one = {
      inputTokens: 1,
      outputTokens: 2,
      cacheReadInputTokens: 3,
      cacheWriteInputTokens: 4,
    };
    expect(addUsage(one, one)).toEqual({
      inputTokens: 2,
      outputTokens: 4,
      cacheReadInputTokens: 6,
      cacheWriteInputTokens: 8,
    });
  });
});

describe("when a cache point pays", () => {
  it("pays from the second call where writing costs more than reading saves at once", () => {
    // Claude Haiku 4.5: write 1.375, read 0.11, plain 1.1.
    expect(breakEvenCalls(haiku)).toBe(2);
    expect(prefixCostMicroUsd({ prefixTokens: 5000, calls: 1 }, haiku)).toEqual({
      uncached: 5500,
      cached: 6875,
    });
    const two = prefixCostMicroUsd({ prefixTokens: 5000, calls: 2 }, haiku);
    expect(two.cached).toBeLessThan(two.uncached);
  });

  it("pays from the first call where the list price of a write is zero", () => {
    // Nova 2 Lite: the Price List gives 0 for a cache write and 0.099 for a read.
    expect(breakEvenCalls(nova)).toBe(1);
    const four = prefixCostMicroUsd({ prefixTokens: 2000, calls: 4 }, nova);
    expect(four.uncached).toBeCloseTo(3168);
    expect(four.cached).toBeCloseTo(594);
  });

  it("never pays where a read costs as much as plain input", () => {
    expect(breakEvenCalls({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1 })).toBeNull();
  });
});

describe("the budget", () => {
  const DAY = "2026-10-13";

  it("refuses a request the day cannot take, before anything is spent", async () => {
    const ledger = new InMemoryUsageLedger();
    expect(await ledger.reserve("alice", DAY, 600, 1000)).toBe(true);
    expect(await ledger.reserve("alice", DAY, 600, 1000)).toBe(false);
    expect(await ledger.spent("alice", DAY)).toBe(600);
    // Another owner, and another day, have their own.
    expect(await ledger.reserve("bob", DAY, 600, 1000)).toBe(true);
    expect(await ledger.reserve("alice", "2026-10-14", 600, 1000)).toBe(true);
  });

  it("gives back what was set aside and not spent", async () => {
    const ledger = new InMemoryUsageLedger();
    await ledger.reserve("alice", DAY, 600, 1000);
    await ledger.settle("alice", DAY, 600, 40);
    expect(await ledger.spent("alice", DAY)).toBe(40);
    expect(await ledger.reserve("alice", DAY, 600, 1000)).toBe(true);
  });

  it("keeps the worst case counted when a request never settles", async () => {
    const ledger = new InMemoryUsageLedger();
    await ledger.reserve("alice", DAY, 600, 1000);
    // No settle: the process died. The next request sees the day as nearly used up.
    expect(await ledger.reserve("alice", DAY, 600, 1000)).toBe(false);
  });

  it("turns the day over at midnight UTC", () => {
    expect(utcDay(Date.parse("2026-10-13T23:59:59Z"))).toBe("2026-10-13");
    expect(utcDay(Date.parse("2026-10-14T00:00:00Z"))).toBe("2026-10-14");
  });
});

describe("DynamoDbUsageLedger", () => {
  type Sent = { input: Record<string, unknown> };
  const recording = (fail?: Error) => {
    const sent: Sent[] = [];
    const client = {
      send: (command: Sent) => {
        sent.push(command);
        return fail === undefined ? Promise.resolve({}) : Promise.reject(fail);
      },
    };
    return { sent, ledger: new DynamoDbUsageLedger(client as never, "usage") };
  };

  it("checks the limit and adds the amount in one conditional update", async () => {
    const { sent, ledger } = recording();
    expect(await ledger.reserve("alice", "2026-10-13", 600, 1000)).toBe(true);
    expect(sent[0]?.input).toMatchObject({
      TableName: "usage",
      Key: { owner: "alice", day: "2026-10-13" },
      ConditionExpression: "attribute_not_exists(microUsd) OR microUsd <= :room",
      ExpressionAttributeValues: { ":amount": 600, ":room": 400 },
    });
    expect(String(sent[0]?.input["UpdateExpression"])).toContain("ADD microUsd :amount");
  });

  it("reads a failed condition as 'over budget' and lets every other error through", async () => {
    const over = recording(new ConditionalCheckFailedException({ message: "no", $metadata: {} }));
    expect(await over.ledger.reserve("alice", "2026-10-13", 600, 1000)).toBe(false);
    const broken = recording(new Error("network"));
    await expect(broken.ledger.reserve("alice", "2026-10-13", 600, 1000)).rejects.toThrow(
      "network",
    );
  });

  it("settles by adding the difference, which may be negative", async () => {
    const { sent, ledger } = recording();
    await ledger.settle("alice", "2026-10-13", 600, 40);
    expect(sent[0]?.input).toMatchObject({ ExpressionAttributeValues: { ":delta": -560 } });
  });
});
