import { describe, expect, it } from "vite-plus/test";

import type { Db } from "../src/db.ts";
import {
  backoffMs,
  createTransactionRunner,
  isSerializationFailure,
  RetriesExhaustedError,
} from "../src/transaction.ts";
import { serializationFailure } from "./support.ts";

// A session that records what it is asked and fails where the test says.
function scriptedDb(failures: Record<string, Error[]>) {
  const log: string[] = [];
  const db: Db = {
    close: () => Promise.resolve(),
    withConnection: (use) =>
      use({
        async query(text) {
          log.push(text);
          const failure = failures[text]?.shift();
          if (failure !== undefined) {
            throw failure;
          }
          return { rows: [] };
        },
      }),
  };
  return { db, log };
}

function runner(db: Db, maxAttempts = 4) {
  const sleeps: number[] = [];
  const retries: number[] = [];
  const transaction = createTransactionRunner({
    db,
    policy: { maxAttempts, baseDelayMs: 20, maxDelayMs: 100 },
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    onRetry: ({ attempt }) => retries.push(attempt),
  });
  return { transaction, sleeps, retries };
}

describe("transaction runner", () => {
  it("runs the whole body again when COMMIT reports a conflict", async () => {
    const { db, log } = scriptedDb({ COMMIT: [serializationFailure()] });
    const { transaction, retries } = runner(db);
    let runs = 0;

    const result = await transaction(async (tx) => {
      runs++;
      await tx.query("UPDATE something");
      return `run ${runs}`;
    });

    expect(result).toBe("run 2");
    expect(retries).toEqual([1]);
    expect(log).toEqual([
      "BEGIN ISOLATION LEVEL REPEATABLE READ",
      "UPDATE something",
      "COMMIT",
      "ROLLBACK",
      "BEGIN ISOLATION LEVEL REPEATABLE READ",
      "UPDATE something",
      "COMMIT",
    ]);
  });

  it("retries a conflict that a statement reports before COMMIT", async () => {
    const { db, log } = scriptedDb({ "UPDATE something": [serializationFailure()] });
    const { transaction } = runner(db);

    await transaction((tx) => tx.query("UPDATE something"));

    expect(log.filter((text) => text === "COMMIT")).toHaveLength(1);
    expect(log.filter((text) => text === "ROLLBACK")).toHaveLength(1);
  });

  it("gives up after maxAttempts without ever committing", async () => {
    const conflicts = [serializationFailure(), serializationFailure(), serializationFailure()];
    const { db, log } = scriptedDb({ COMMIT: conflicts });
    const { transaction, sleeps } = runner(db, 3);

    await expect(transaction((tx) => tx.query("UPDATE something"))).rejects.toBeInstanceOf(
      RetriesExhaustedError,
    );

    expect(log.filter((text) => text === "COMMIT")).toHaveLength(3);
    expect(log.filter((text) => text === "ROLLBACK")).toHaveLength(3);
    // Two waits for three attempts: none after the last.
    expect(sleeps).toHaveLength(2);
  });

  it("does not retry an error that is not a serialization failure", async () => {
    const duplicate = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
    const { db, log } = scriptedDb({ "INSERT something": [duplicate] });
    const { transaction, sleeps } = runner(db);

    await expect(transaction((tx) => tx.query("INSERT something"))).rejects.toBe(duplicate);

    expect(log).toEqual(["BEGIN ISOLATION LEVEL REPEATABLE READ", "INSERT something", "ROLLBACK"]);
    expect(sleeps).toEqual([]);
  });

  it("rolls back and reports the first error when the body throws", async () => {
    const { db, log } = scriptedDb({ ROLLBACK: [new Error("connection lost")] });
    const { transaction } = runner(db);
    const bug = new Error("bug in the body");

    await expect(
      transaction(() => {
        throw bug;
      }),
    ).rejects.toBe(bug);
    expect(log.at(-1)).toBe("ROLLBACK");
  });

  it("recognises SQLSTATE 40001 and nothing else as a conflict", () => {
    expect(isSerializationFailure(serializationFailure())).toBe(true);
    expect(
      isSerializationFailure(Object.assign(new Error("deadlock detected"), { code: "40P01" })),
    ).toBe(false);
    expect(
      isSerializationFailure(new Error("change conflicts with another transaction (OC000)")),
    ).toBe(false);
    expect(isSerializationFailure(undefined)).toBe(false);
  });

  it("waits a random time under a cap that doubles and then stops growing", () => {
    const policy = { maxAttempts: 9, baseDelayMs: 20, maxDelayMs: 100 };
    expect([1, 2, 3, 4, 5].map((attempt) => backoffMs(attempt, policy, () => 0.5))).toEqual([
      10, 20, 40, 50, 50,
    ]);
    expect(backoffMs(3, policy, () => 0)).toBe(0);
    expect(backoffMs(3, policy, () => 0.999)).toBeLessThan(80);
  });
});
