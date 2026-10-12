import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Db, Queryable } from "@aih/example-13-sql/src/db.ts";

import { type AppendResult, appendResultSchema, appendToNote } from "../src/append.ts";
import { classify, ConnectionLostError } from "../src/failure.ts";
import {
  AttemptsExhaustedError,
  purgeRequests,
  type Transactional,
  transactional,
} from "../src/once.ts";
import {
  AT,
  type Drop,
  dropping,
  migratedDb,
  onceFor,
  policy,
  seedNote,
  stored,
} from "./support.ts";

let db: Db;
beforeAll(async () => {
  db = await migratedDb();
});
afterAll(() => db.close());

type Note = { owner: string; id: string };
const append = (tx: Queryable, note: Note) => appendToNote(tx, { ...note, text: "b", at: AT });
const appendOnce = (database: Transactional, note: Note, key = "key-1") =>
  onceFor(database).once({ owner: note.owner, key, result: appendResultSchema }, (tx) =>
    append(tx, note),
  );

// #region naive
// What a retry loop without a key does: any attempt that ends without an
// answer is simply made again.
async function appendRetrying(database: Transactional, note: Note): Promise<AppendResult> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await database.transaction((tx) => append(tx, note));
    } catch (error) {
      if (classify(error) === "other" || attempt >= policy.maxAttempts) {
        throw error;
      }
    }
  }
}
// #endregion naive

const APPENDED: AppendResult = { status: "appended", version: 2, length: 2 };

describe("a transaction interrupted by a failover", () => {
  it("is five statements when nothing goes wrong", async () => {
    const note = await seedNote(db);
    const session = dropping(db, undefined);

    expect(await appendOnce(transactional(session), note)).toEqual(APPENDED);

    expect(session.statements.map((text) => text.trim().split(/\s+/)[0])).toEqual([
      "BEGIN",
      "SELECT",
      "UPDATE",
      "INSERT",
      "COMMIT",
    ]);
    expect(await stored(db, note)).toEqual({ body: "ab", version: 2, requests: 1 });
  });

  // #region every-point
  const drops: Drop[] = [1, 2, 3, 4, 5].flatMap((statement) => [
    { statement, when: "before" as const },
    { statement, when: "after" as const },
  ]);

  it.each(drops)(
    "is applied once when the session drops $when statement $statement",
    async (drop) => {
      const note = await seedNote(db);

      const result = await appendOnce(transactional(dropping(db, drop)), note);

      // The caller hears what an undisturbed run would have told it, and the
      // note was appended to exactly once.
      expect(result).toEqual(APPENDED);
      expect(await stored(db, note)).toEqual({ body: "ab", version: 2, requests: 1 });
    },
  );
  // #endregion every-point

  // #region twice
  it("is applied twice by a retry without a key, when the answer to COMMIT is lost", async () => {
    const note = await seedNote(db);
    // BEGIN, UPDATE, COMMIT: the third statement is the commit.
    const session = dropping(db, { statement: 3, when: "after" });

    const result = await appendRetrying(transactional(session), note);

    expect(result).toEqual({ status: "appended", version: 3, length: 3 });
    expect((await stored(db, note)).body).toBe("abb");
  });
  // #endregion twice

  it("does not run the body again for a key it has recorded", async () => {
    const note = await seedNote(db);
    let runs = 0;
    const { once } = onceFor(transactional(db));
    const request = { owner: note.owner, key: "tap-1", result: appendResultSchema };
    const body = (tx: Queryable) => {
      runs++;
      return append(tx, note);
    };

    const first = await once(request, body);
    const second = await once(request, body);

    expect(second).toEqual(first);
    expect(runs).toBe(1);
    // A new key is a new request.
    expect(await once({ ...request, key: "tap-2" }, body)).toMatchObject({ version: 3 });
  });

  it("keeps the keys of one owner apart from another's", async () => {
    const [mine, theirs] = [await seedNote(db), await seedNote(db)];

    await appendOnce(transactional(db), mine, "same-key");
    await appendOnce(transactional(db), theirs, "same-key");

    expect(await stored(db, mine)).toEqual({ body: "ab", version: 2, requests: 1 });
    expect(await stored(db, theirs)).toEqual({ body: "ab", version: 2, requests: 1 });
  });

  it("records an answer that changed nothing, so a retry gets the same answer", async () => {
    const note = await seedNote(db);
    const missing = { owner: note.owner, id: "00000000-0000-4000-8000-000000000000" };

    expect(await appendOnce(transactional(db), missing)).toEqual({ status: "not_found" });
    expect(await appendOnce(transactional(db), missing)).toEqual({ status: "not_found" });
    expect((await stored(db, note)).requests).toBe(1);
  });

  it("neither retries nor records a request the database refuses", async () => {
    const note = await seedNote(db);
    const { once, sleeps } = onceFor(transactional(db));

    await expect(
      once({ owner: note.owner, key: "bad", result: appendResultSchema }, async (tx) => {
        const result = await append(tx, note);
        await tx.query("SELECT 1 / 0");
        return result;
      }),
    ).rejects.toMatchObject({ code: "22012" });

    expect(sleeps).toEqual([]);
    // The append made before the error was rolled back with it.
    expect(await stored(db, note)).toEqual({ body: "a", version: 1, requests: 0 });
  });
});

// A database that answers from a script, for the orders PGlite's single
// session cannot produce.
function scripted(answers: (unknown[] | Error)[]): Transactional & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    transaction: (body) =>
      body({
        async query(text) {
          asked.push(text.trim().split(/\s+/)[0] ?? "");
          const answer = answers.shift();
          if (answer === undefined || answer instanceof Error) {
            throw answer ?? new Error("The script ran out.");
          }
          return { rows: answer };
        },
      }),
  };
}

describe("the once runner", () => {
  it("starts over when another transaction recorded the key first", async () => {
    const winner = JSON.stringify({ status: "appended", version: 2, length: 2 });
    const database = scripted([
      [], // no key yet
      [], // the INSERT returned no row: the key was taken meanwhile
      [{ result: winner }], // second attempt: the key is there
    ]);
    let runs = 0;
    const { once } = onceFor(database);

    const result = await once({ owner: "o", key: "k", result: appendResultSchema }, async () => {
      runs++;
      return { status: "appended", version: 9, length: 9 } as const;
    });

    // This attempt's own work was thrown away; the answer is the winner's.
    expect(result).toEqual(JSON.parse(winner));
    expect(runs).toBe(1);
    expect(database.asked).toEqual(["SELECT", "INSERT", "SELECT"]);
  });

  it("gives up after maxAttempts and says the outcome is unknown", async () => {
    const lost = () => new ConnectionLostError("gone");
    const database = scripted([lost(), lost(), lost(), lost()]);
    const { once, sleeps } = onceFor(database);

    await expect(
      once({ owner: "o", key: "k", result: appendResultSchema }, () =>
        Promise.resolve({ status: "not_found" } as const),
      ),
    ).rejects.toBeInstanceOf(AttemptsExhaustedError);

    // Three waits for four attempts, each half of a cap that doubles.
    expect(sleeps).toEqual([10, 20, 40]);
  });

  it("refuses a stored result that no longer fits the schema", async () => {
    const database = scripted([[{ result: JSON.stringify({ status: "renamed" }) }]]);
    const { once } = onceFor(database);

    await expect(
      once({ owner: "o", key: "k", result: appendResultSchema }, () =>
        Promise.resolve({ status: "not_found" } as const),
      ),
    ).rejects.toThrow();
  });

  it("purges the keys older than the time a client may still retry", async () => {
    const note = await seedNote(db);
    await appendOnce(transactional(db), note);

    const before = await db.withConnection((tx) => purgeRequests(tx, AT));
    const after = await db.withConnection((tx) => purgeRequests(tx, new Date(AT.getTime() + 1)));

    // Other tests share this database, so only this owner's row is counted.
    expect(before).toBe(0);
    expect(after).toBeGreaterThanOrEqual(1);
    expect((await stored(db, note)).requests).toBe(0);
  });
});
