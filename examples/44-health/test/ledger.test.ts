import { describe, expect, it } from "vite-plus/test";

import { CLAIM_MS, decide, type Entry, keyOf, versionOf } from "../src/ledger.ts";
import { parsed } from "./fixtures.ts";

const NOW = 1_800_000_000_000;
const stored = (over: Partial<Entry> = {}): Entry => ({
  revision: "open|a",
  clock: 100,
  status: "open",
  notified: true,
  claimedAt: NOW - 3_600_000,
  writes: 2,
  ...over,
});

describe("decide", () => {
  it("announces an event it has never seen", () => {
    expect(decide(undefined, { revision: "open|a", clock: 100, status: "open" }, NOW)).toEqual({
      do: "announce",
      change: "new",
    });
  });

  it("skips the same state delivered again", () => {
    expect(decide(stored(), { revision: "open|a", clock: 100, status: "open" }, NOW)).toEqual({
      do: "skip",
      why: "duplicate",
    });
  });

  it("announces a newer state, and names a closure", () => {
    expect(decide(stored(), { revision: "open|b", clock: 200, status: "open" }, NOW)).toEqual({
      do: "announce",
      change: "update",
    });
    expect(decide(stored(), { revision: "closed|b", clock: 200, status: "closed" }, NOW)).toEqual({
      do: "announce",
      change: "closed",
    });
  });

  it("skips a state older than the one it announced", () => {
    const closed = stored({ revision: "closed|c", clock: 300, status: "closed" });
    expect(decide(closed, { revision: "open|b", clock: 200, status: "open" }, NOW)).toEqual({
      do: "skip",
      why: "stale",
    });
  });

  it("does not reopen an event on a message stamped with the same second as its closure", () => {
    const closed = stored({ revision: "closed|c", clock: 300, status: "closed" });
    expect(decide(closed, { revision: "open|c", clock: 300, status: "open" }, NOW)).toEqual({
      do: "skip",
      why: "stale",
    });
    // The other way round, the closure wins.
    const open = stored({ revision: "open|c", clock: 300 });
    expect(decide(open, { revision: "closed|c", clock: 300, status: "closed" }, NOW)).toEqual({
      do: "announce",
      change: "closed",
    });
  });

  it("moves the clock without a message when a newer delivery changes nothing worth sending", () => {
    expect(decide(stored(), { revision: "open|a", clock: 150, status: "open" }, NOW)).toEqual({
      do: "advance",
    });
  });

  it("leaves a fresh claim alone, and takes over one that was never settled", () => {
    const version = { revision: "open|a", clock: 100, status: "open" } as const;
    const fresh = stored({ notified: false, claimedAt: NOW - CLAIM_MS + 1 });
    expect(decide(fresh, version, NOW)).toEqual({ do: "skip", why: "in-flight" });
    const abandoned = stored({ notified: false, claimedAt: NOW - CLAIM_MS });
    expect(decide(abandoned, version, NOW)).toEqual({ do: "announce", change: "retry" });
  });

  it("announces a newer state even while an older one is still being sent", () => {
    const fresh = stored({ notified: false, claimedAt: NOW - 1 });
    expect(decide(fresh, { revision: "closed|b", clock: 200, status: "closed" }, NOW)).toEqual({
      do: "announce",
      change: "closed",
    });
  });
});

describe("what counts as a change", () => {
  const open = parsed("tokyo-lambda-issue-open");
  const update = parsed("tokyo-lambda-issue-update");

  it("gives every update of an incident its own revision", () => {
    expect(versionOf(open, "incident").revision).not.toBe(versionOf(update, "incident").revision);
  });

  it("gives a planned change one revision until its status or its dates move", () => {
    const first = parsed("tokyo-ec2-retirement");
    const later = structuredClone(first);
    later.detail.lastUpdatedTime = first.detail.startTime - 1;
    expect(versionOf(later, "act-by-date").revision).toBe(versionOf(first, "act-by-date").revision);
    expect(versionOf(later, "act-by-date").clock).toBeGreaterThan(
      versionOf(first, "act-by-date").clock,
    );

    const moved = structuredClone(later);
    moved.detail.startTime += 86_400_000;
    expect(versionOf(moved, "act-by-date").revision).not.toBe(
      versionOf(first, "act-by-date").revision,
    );
  });

  it("orders by the delivery time when the event carries no lastUpdatedTime", () => {
    const sample = parsed("docs-account-elb-api-issue");
    expect(versionOf(sample, "incident").clock).toBe(Date.parse("2022-06-10T06:27:57Z"));
  });

  it("keys an event by account and ARN, since the ARN alone is shared between accounts", () => {
    const other = structuredClone(open);
    other.detail.affectedAccount = "210987654321";
    expect(keyOf(open)).not.toBe(keyOf(other));
    expect(keyOf(open)).toBe(keyOf(update));
  });
});
