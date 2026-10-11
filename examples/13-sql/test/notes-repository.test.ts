import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import type { Note } from "../src/contract.ts";
import { type Db, sqlStateOf } from "../src/db.ts";
import { SqlNoteRepository } from "../src/notes-repository.ts";
import { RetriesExhaustedError } from "../src/transaction.ts";
import { counts, losingCommits, migratedDb, runnerFor } from "./support.ts";

// PGlite: real PostgreSQL SQL, constraints, and transactions, on one session.
// It never produces a conflict by itself, so conflicts are injected.
let db: Db;
beforeAll(async () => {
  // Booting PGlite and migrating can take seconds on a busy machine.
  db = await migratedDb();
}, 60_000);
afterAll(() => db.close());

const QUOTA = 2;
const repositoryOn = (database: Db) => new SqlNoteRepository(runnerFor(database).transaction, QUOTA);
const freshOwner = () => `owner-${randomUUID()}`;

const note = (overrides: Partial<Note> = {}): Note => ({
  id: randomUUID(),
  title: "a note",
  body: "",
  version: 1,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
  ...overrides,
});

const change = (expectedVersion: number, title = "changed") => ({
  title,
  body: "new body",
  expectedVersion,
  updatedAt: "2026-10-11T01:00:00.000Z",
});

describe("SqlNoteRepository on PostgreSQL", () => {
  it("stores a note and reads it back unchanged", async () => {
    const repository = repositoryOn(db);
    const owner = freshOwner();
    const first = note({ title: "first", body: "hello" });

    expect(await repository.create(owner, first)).toBe("created");
    expect(await repository.get(owner, first.id)).toEqual(first);
  });

  it("lists an owner's notes newest first, and nobody else's", async () => {
    const repository = repositoryOn(db);
    const owner = freshOwner();
    await repository.create(owner, note({ title: "older", createdAt: "2026-10-11T00:00:00.000Z" }));
    await repository.create(owner, note({ title: "newer", createdAt: "2026-10-11T00:00:01.000Z" }));
    await repository.create(freshOwner(), note({ title: "someone else's" }));

    expect((await repository.list(owner)).map((item) => item.title)).toEqual(["newer", "older"]);
  });

  it("moves the version by one on update and refuses a stale one", async () => {
    const repository = repositoryOn(db);
    const owner = freshOwner();
    const original = note();
    await repository.create(owner, original);

    expect(await repository.update(owner, original.id, change(1, "first writer"))).toMatchObject({
      status: "updated",
      note: { version: 2, title: "first writer", createdAt: original.createdAt },
    });
    expect(await repository.update(owner, original.id, change(1, "second writer"))).toMatchObject({
      status: "conflict",
      current: { version: 2, title: "first writer" },
    });
    expect(await repository.update(owner, randomUUID(), change(1))).toEqual({ status: "not_found" });
  });

  it("does not let one owner read, change, or delete another owner's note", async () => {
    const repository = repositoryOn(db);
    const owner = freshOwner();
    const intruder = freshOwner();
    const secret = note({ title: "secret" });
    await repository.create(owner, secret);

    expect(await repository.get(intruder, secret.id)).toBeUndefined();
    expect(await repository.update(intruder, secret.id, change(1))).toEqual({ status: "not_found" });
    expect(await repository.delete(intruder, secret.id)).toBe(false);
    expect(await repository.get(owner, secret.id)).toMatchObject({ title: "secret", version: 1 });
  });

  it("refuses a note past the quota, and frees the slot on delete", async () => {
    const repository = repositoryOn(db);
    const owner = freshOwner();
    const first = note();
    await repository.create(owner, first);
    await repository.create(owner, note());

    expect(await repository.create(owner, note())).toBe("quota_exceeded");
    expect(await counts(db, owner)).toEqual({ counted: 2, stored: 2 });

    expect(await repository.delete(owner, first.id)).toBe(true);
    expect(await repository.delete(owner, first.id)).toBe(false);
    expect(await counts(db, owner)).toEqual({ counted: 1, stored: 1 });
    expect(await repository.create(owner, note())).toBe("created");
  });

  it("leaves the constraints to the database as well", async () => {
    const owner = freshOwner();
    const insert = (title: string) =>
      db.withConnection((connection) =>
        connection.query(
          "INSERT INTO app.notes (id, owner, title, body, version, created_at, updated_at) VALUES ($1, $2, $3, '', 1, now(), now())",
          [randomUUID(), owner, title],
        ),
      );
    // 23503: no owner row to reference. 23514: the CHECK on the title.
    expect(sqlStateOf(await insert("orphan").catch((error: unknown) => error))).toBe("23503");
    await repositoryOn(db).create(owner, note());
    expect(sqlStateOf(await insert("x".repeat(121)).catch((error: unknown) => error))).toBe("23514");
  });
});

// #region conflicts
describe("SqlNoteRepository when a commit loses", () => {
  it("writes the note once when the first COMMIT conflicts", async () => {
    const losing = losingCommits(db, { conflicts: 1 });
    const repository = repositoryOn(losing);
    const owner = freshOwner();
    const only = note();

    expect(await repository.create(owner, only)).toBe("created");

    expect(losing.commitsAttempted()).toBe(2);
    expect(await repository.list(owner)).toEqual([only]);
    expect(await counts(db, owner)).toEqual({ counted: 1, stored: 1 });
  });

  it("re-reads on retry, so the loser of the last slot gets quota_exceeded", async () => {
    const owner = freshOwner();
    await repositoryOn(db).create(owner, note({ title: "already there" }));
    // Both transactions read note_count = 1 with one slot left. The winner
    // commits first; the loser's COMMIT is refused.
    const winning = note({ title: "winner" });
    const losing = losingCommits(db, {
      conflicts: 1,
      winner: async (transaction) => {
        await new SqlNoteRepository(transaction, QUOTA).create(owner, winning);
      },
    });

    const result = await repositoryOn(losing).create(owner, note({ title: "loser" }));

    // Replaying the loser's INSERT without re-reading would have made a third note.
    expect(result).toBe("quota_exceeded");
    expect((await repositoryOn(db).list(owner)).map((item) => item.title).toSorted()).toEqual([
      "already there",
      "winner",
    ]);
    expect(await counts(db, owner)).toEqual({ counted: QUOTA, stored: QUOTA });
  });

  it("is safe to run again after a commit whose outcome was never heard", async () => {
    const repository = repositoryOn(db);
    const owner = freshOwner();
    const same = note();

    expect(await repository.create(owner, same)).toBe("created");
    // The caller lost the answer and sends the same note again.
    expect(await repository.create(owner, same)).toBe("created");

    expect(await counts(db, owner)).toEqual({ counted: 1, stored: 1 });
  });

  it("reports the other writer's version when an update loses and is retried", async () => {
    const owner = freshOwner();
    const shared = note();
    await repositoryOn(db).create(owner, shared);
    const losing = losingCommits(db, {
      conflicts: 1,
      winner: async (transaction) => {
        await new SqlNoteRepository(transaction, QUOTA).update(owner, shared.id, change(1, "winner"));
      },
    });

    const result = await repositoryOn(losing).update(owner, shared.id, change(1, "loser"));

    expect(result).toMatchObject({ status: "conflict", current: { version: 2, title: "winner" } });
  });

  it("frees one slot, not two, when a delete is retried", async () => {
    const owner = freshOwner();
    const first = note();
    await repositoryOn(db).create(owner, first);
    await repositoryOn(db).create(owner, note());
    const losing = losingCommits(db, { conflicts: 2 });

    expect(await repositoryOn(losing).delete(owner, first.id)).toBe(true);

    expect(losing.commitsAttempted()).toBe(3);
    expect(await counts(db, owner)).toEqual({ counted: 1, stored: 1 });
  });

  it("changes nothing when every attempt conflicts", async () => {
    const owner = freshOwner();
    const losing = losingCommits(db, { conflicts: 4 });

    await expect(repositoryOn(losing).create(owner, note())).rejects.toBeInstanceOf(RetriesExhaustedError);

    expect(await counts(db, owner)).toEqual({ counted: 0, stored: 0 });
  });
});
// #endregion conflicts
