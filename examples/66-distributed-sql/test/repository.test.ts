import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Db } from "@aih/example-13-sql/src/db.ts";
import { SqlNoteRepository } from "@aih/example-13-sql/src/notes-repository.ts";
import { isSerializationFailure } from "@aih/example-13-sql/src/transaction.ts";
import { counts, migratedDb, runnerFor } from "@aih/example-13-sql/test/support.ts";

// PGlite, not YugabyteDB: one session, never a real conflict. The errors
// injected below are copies of what the local YugabyteDB cluster answered in
// scripts/verify.ts, so the question here is only what chapter 13's loop does
// with them.

// #region fixtures
/** What node b answered when node a had committed an update of the same row first (2025.2.7.0, REPEATABLE READ). */
export function yugabyteConflict(): Error {
  return Object.assign(
    new Error(
      "could not serialize access due to concurrent update (query layer retry isn't possible because this is not the first command in the transaction. Consider using READ COMMITTED isolation level.)",
    ),
    { code: "40001" },
  );
}

/** The code and message the documentation gives for a deadlock. Not produced on the local cluster. */
export function yugabyteDeadlock(): Error {
  return Object.assign(new Error("deadlock detected"), { code: "40P01" });
}
// #endregion fixtures

/** Fails the first `times` statements that start with `prefix`, the way a conflict fails one: mid-transaction. */
function failingStatements(db: Db, prefix: string, times: number, error: () => Error): Db {
  let remaining = times;
  return {
    close: () => db.close(),
    withConnection: (use) =>
      db.withConnection((connection) =>
        use({
          query(text, params) {
            if (remaining > 0 && text.startsWith(prefix)) {
              remaining--;
              return Promise.reject(error());
            }
            return connection.query(text, params);
          },
        }),
      ),
  };
}

const note = (id: string) => ({
  id,
  title: "t",
  body: "",
  version: 1,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
});

describe("chapter 13's retry loop, given YugabyteDB's errors (on PGlite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = await migratedDb();
  });
  afterAll(() => db.close());

  it("recognizes the conflict by SQLSTATE, whatever the message says", () => {
    expect(isSerializationFailure(yugabyteConflict())).toBe(true);
    expect(isSerializationFailure(yugabyteDeadlock())).toBe(false);
  });

  it("retries a conflict that arrives on a statement, not at COMMIT, and leaves one note and a count of one", async () => {
    const flaky = failingStatements(db, "UPDATE app.owners", 2, yugabyteConflict);
    const { transaction, sleeps } = runnerFor(flaky);
    const notes = new SqlNoteRepository(transaction, 10);
    expect(await notes.create("owner-conflict", note("7e5e1c0e-0000-4000-8000-000000000001"))).toBe(
      "created",
    );
    expect(sleeps).toHaveLength(2);
    expect(await counts(db, "owner-conflict")).toEqual({ counted: 1, stored: 1 });
  });

  it("gives up after the policy's attempts and leaves nothing half done", async () => {
    const flaky = failingStatements(db, "UPDATE app.owners", 99, yugabyteConflict);
    const notes = new SqlNoteRepository(runnerFor(flaky).transaction, 10);
    await expect(
      notes.create("owner-exhausted", note("7e5e1c0e-0000-4000-8000-000000000002")),
    ).rejects.toThrow(/conflicted 4 times/);
    expect(await counts(db, "owner-exhausted")).toEqual({ counted: 0, stored: 0 });
  });

  it("does not retry a deadlock: the loop knows 40001 only, and the error reaches the caller", async () => {
    const flaky = failingStatements(db, "UPDATE app.owners", 1, yugabyteDeadlock);
    const { transaction, sleeps } = runnerFor(flaky);
    const notes = new SqlNoteRepository(transaction, 10);
    await expect(
      notes.create("owner-deadlock", note("7e5e1c0e-0000-4000-8000-000000000003")),
    ).rejects.toThrow("deadlock detected");
    expect(sleeps).toHaveLength(0);
    expect(await counts(db, "owner-deadlock")).toEqual({ counted: 0, stored: 0 });
  });

  it("makes a create whose answer was lost safe to send again with the same id", async () => {
    const notes = new SqlNoteRepository(runnerFor(db).transaction, 10);
    const lost = note("7e5e1c0e-0000-4000-8000-000000000004");
    expect(await notes.create("owner-lost", lost)).toBe("created");
    // The caller never heard, and sends the same note through another node.
    expect(await notes.create("owner-lost", lost)).toBe("created");
    expect(await counts(db, "owner-lost")).toEqual({ counted: 1, stored: 1 });
  });
});
