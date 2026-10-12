import { describe, expect, it } from "vite-plus/test";

import type { Batch } from "../src/kvs/plan.ts";
import {
  KvsConflictError,
  type KvsPort,
  KvsUnavailableError,
  type Snapshot,
  syncStore,
} from "../src/kvs/sync.ts";

type Step = {
  /** Runs just before the store looks at the request: another writer getting in first. */
  before?: (store: FakeStore) => void;
  fault?: "refused" | "response-lost" | "crash";
};

/** A store with the one rule that matters here: a write needs the current ETag. */
class FakeStore implements KvsPort {
  entries = new Map<string, string>();
  version = 1;
  reads = 0;
  applied: Batch[] = [];
  attempts = 0;
  /** One entry per update call, in order. Calls past the end behave normally. */
  script: Step[] = [];

  get etag(): string {
    return `E${this.version}`;
  }

  writeFromElsewhere(key: string, value: string): void {
    this.entries.set(key, value);
    this.version++;
  }

  read(): Promise<Snapshot> {
    this.reads++;
    return Promise.resolve({ etag: this.etag, entries: new Map(this.entries) });
  }

  update(etag: string, batch: Batch): Promise<string> {
    this.attempts++;
    const step = this.script.shift();
    step?.before?.(this);
    if (step?.fault === "refused") {
      return Promise.reject(new Error("AccessDeniedException"));
    }
    if (step?.fault === "crash") {
      return Promise.reject(new Error("the process was killed"));
    }
    if (etag !== this.etag) {
      return Promise.reject(new KvsConflictError(`expected ${this.etag}, got ${etag}`));
    }
    for (const pair of batch.puts) {
      this.entries.set(pair.key, pair.value);
    }
    for (const key of batch.deletes) {
      this.entries.delete(key);
    }
    this.version++;
    this.applied.push(batch);
    if (step?.fault === "response-lost") {
      return Promise.reject(new KvsUnavailableError("socket hang up"));
    }
    return Promise.resolve(this.etag);
  }
}

const desired = new Map([
  ["flag:maintenance", "on"],
  ["redirect:/plans", '{"to":"/pricing/","status":301}'],
]);
const many = new Map(Array.from({ length: 120 }, (_, index) => [`redirect:/page-${index}`, "x"]));
const managed = (store: FakeStore) =>
  new Map([...store.entries].filter(([key]) => !key.startsWith("tenant:")));

describe("syncStore", () => {
  it("makes the store match, and does nothing the second time", async () => {
    const store = new FakeStore();
    store.entries.set("redirect:/gone", "x");

    expect(await syncStore(store, desired)).toMatchObject({ outcome: "applied", rounds: 1 });
    expect(store.entries).toEqual(desired);

    expect(await syncStore(store, desired)).toMatchObject({
      outcome: "already-in-sync",
      plans: [],
    });
    expect(store.attempts).toBe(1);
  });

  it("does not overwrite a change it has not seen", async () => {
    // read -> (someone else writes) -> update with the old ETag
    const store = new FakeStore();
    store.script = [
      {
        before: (other) => {
          other.writeFromElsewhere("tenant:acme", "blue");
          other.writeFromElsewhere("redirect:/plans", '{"to":"/elsewhere/","status":302}');
        },
      },
    ];

    const result = await syncStore(store, desired);

    expect(result).toMatchObject({ outcome: "applied", rounds: 2 });
    // The first request changed nothing. The second was planned from a read that saw both writes.
    expect(store.applied).toHaveLength(1);
    expect(result.plans[1]?.foreign).toEqual(["tenant:acme"]);
    expect(store.entries.get("tenant:acme")).toBe("blue");
    expect(managed(store)).toEqual(desired);
  });

  it("does not apply a write twice when its response is lost", async () => {
    // update lands -> the answer never arrives -> retry
    const store = new FakeStore();
    store.script = [{ fault: "response-lost" }];

    const result = await syncStore(store, desired);

    expect(result).toMatchObject({ outcome: "applied", rounds: 2 });
    expect(store.attempts).toBe(1);
    expect(store.entries).toEqual(desired);
  });

  it("finishes on the next run after dying between two requests", async () => {
    // 120 keys are three requests. The process dies on the second.
    const store = new FakeStore();
    store.script = [{}, { fault: "crash" }];

    await expect(syncStore(store, many)).rejects.toThrow("killed");
    expect(store.entries.size).toBe(50);

    const second = await syncStore(store, many);
    expect(second.plans[0]?.puts).toHaveLength(70);
    expect(store.entries).toEqual(many);
  });

  it("plans again when another writer gets in between two requests", async () => {
    const store = new FakeStore();
    store.script = [
      {},
      { before: (other) => other.writeFromElsewhere("redirect:/page-0", "changed") },
    ];

    const result = await syncStore(store, many);

    expect(result.rounds).toBe(2);
    expect(result.plans[1]?.puts).toHaveLength(71);
    expect(store.entries).toEqual(many);
  });

  it("gives up instead of retrying forever", async () => {
    const store = new FakeStore();
    const interfere: Step = {
      before: (other) => other.writeFromElsewhere("tenant:acme", String(other.version)),
    };
    store.script = Array.from({ length: 10 }, () => interfere);

    await expect(syncStore(store, desired, { maxRounds: 3 })).rejects.toThrow(/3 rounds/);
    expect(store.attempts).toBe(3);
    expect(managed(store).size).toBe(0);
  });

  it("does not retry an error it does not understand", async () => {
    const store = new FakeStore();
    store.script = [{ fault: "refused" }];

    await expect(syncStore(store, desired)).rejects.toThrow("AccessDenied");
    expect(store.reads).toBe(1);
  });
});
