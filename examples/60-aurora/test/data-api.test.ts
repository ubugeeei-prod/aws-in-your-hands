import {
  BeginTransactionCommand,
  CommitTransactionCommand,
  DatabaseErrorException,
  DatabaseResumingException,
  ExecuteStatementCommand,
  type Field,
  ForbiddenException,
  RollbackTransactionCommand,
  ServiceUnavailableError,
  type SqlParameter,
  TransactionNotFoundException,
} from "@aws-sdk/client-rds-data";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Db } from "@aih/example-13-sql/src/db.ts";

import { appendResultSchema, appendToNote } from "../src/append.ts";
import {
  createDataApiClient,
  dataApi,
  type DataApiSender,
  toNamedSql,
  toRows,
  toSqlParameters,
  translate,
} from "../src/data-api.ts";
import { classify, ConnectionLostError } from "../src/failure.ts";
import { allMigrations } from "../src/migrations.ts";
import { AT, migratedDb, onceFor, seedNote, stored } from "./support.ts";

const target = {
  resourceArn: "arn:aws:rds:ap-northeast-1:111122223333:cluster:notes",
  secretArn: "arn:aws:secretsmanager:ap-northeast-1:111122223333:secret:rds!cluster-example",
  database: "notes",
};
const meta = { $metadata: {} };

describe("the Data API adapter's conversions", () => {
  it("turns positional parameters into named ones", () => {
    expect(toNamedSql("SELECT $1, CAST($2 AS uuid), $10")).toBe(
      "SELECT :p1, CAST(:p2 AS uuid), :p10",
    );
    expect(toSqlParameters(["a", 2, 0.5, true, null])).toEqual([
      { name: "p1", value: { stringValue: "a" } },
      { name: "p2", value: { longValue: 2 } },
      { name: "p3", value: { doubleValue: 0.5 } },
      { name: "p4", value: { booleanValue: true } },
      { name: "p5", value: { isNull: true } },
    ]);
  });

  it("refuses a parameter it would have to guess an encoding for", () => {
    expect(() => toSqlParameters([AT])).toThrow(TypeError);
    expect(() => toSqlParameters([["a"]])).toThrow(TypeError);
    expect(() => toSqlParameters([Number.NaN])).toThrow(TypeError);
  });

  it("reads records into rows keyed by column label", () => {
    const records: Field[][] = [
      [{ longValue: 2 }, { stringValue: "ab" }, { isNull: true }, { booleanValue: false }],
    ];
    const columns = [{ label: "version" }, { label: "body" }, { label: "gone" }, { label: "ok" }];

    expect(toRows(records, columns)).toEqual([{ version: 2, body: "ab", gone: null, ok: false }]);
    expect(toRows(undefined, undefined)).toEqual([]);
    expect(() => toRows(records, [])).toThrow(TypeError);
    expect(() => toRows([[{ blobValue: new Uint8Array() }]], [{ label: "b" }])).toThrow(TypeError);
  });

  it("separates an answer from the database from a call with no outcome", () => {
    const refused = new DatabaseErrorException({ ...meta, message: "division by zero" });
    expect(translate(refused)).toBe(refused);
    const forbidden = new ForbiddenException({ ...meta, message: "no" });
    expect(translate(forbidden)).toBe(forbidden);

    for (const error of [
      new DatabaseResumingException({ ...meta, message: "resuming" }),
      new TransactionNotFoundException({ ...meta, message: "expired" }),
      new ServiceUnavailableError({ ...meta, message: "unavailable" }),
      new Error("socket hang up"),
    ]) {
      expect(translate(error)).toBeInstanceOf(ConnectionLostError);
    }
    // A conflict is indistinguishable on this path, so it is not retried.
    expect(classify(translate(refused))).toBe("other");
  });

  it("makes a client that never sends a call a second time by itself", async () => {
    expect(await createDataApiClient("ap-northeast-1").config.maxAttempts()).toBe(1);
  });
});

// #region fake
// A stand-in for the service, written for these tests: one PGlite session
// behind the four operations the adapter calls, answering in the shapes the
// API reference documents (named parameters, Field unions, column labels).
// It is not the Data API; it has one session and no timeouts.
async function fakeDataApi() {
  const pglite = await PGlite.create();
  for (const migration of allMigrations()) {
    await pglite.exec(migration.sql.replace(/\bINDEX\s+ASYNC\b/i, "INDEX"));
  }
  const commands: string[] = [];
  let loseNext: string | undefined;

  const valueOf = (parameter: SqlParameter): unknown => {
    const field: Field = parameter.value ?? { isNull: true };
    return field.isNull === true
      ? null
      : (field.stringValue ?? field.longValue ?? field.doubleValue ?? field.booleanValue);
  };
  const fieldOf = (value: unknown): Field => {
    if (value === null) {
      return { isNull: true };
    }
    if (typeof value === "number") {
      return { longValue: value };
    }
    if (typeof value === "boolean") {
      return { booleanValue: value };
    }
    return { stringValue: String(value) };
  };

  const sender: DataApiSender = {
    // The adapter only ever passes these four commands.
    send: (async (command: unknown) => {
      const name = (command as object).constructor.name;
      commands.push(name);
      let output: object = {};
      if (command instanceof BeginTransactionCommand) {
        await pglite.query("BEGIN");
        output = { transactionId: "tx-1" };
      } else if (command instanceof ExecuteStatementCommand) {
        const sql = (command.input.sql ?? "").replaceAll(/:p(\d+)/g, "$$$1");
        const result = await pglite.query<Record<string, unknown>>(
          sql,
          (command.input.parameters ?? []).map(valueOf),
        );
        output = {
          records: result.rows.map((row) => result.fields.map((f) => fieldOf(row[f.name]))),
          columnMetadata: result.fields.map((f) => ({ label: f.name })),
        };
      } else if (command instanceof CommitTransactionCommand) {
        await pglite.query("COMMIT");
      } else if (command instanceof RollbackTransactionCommand) {
        await pglite.query("ROLLBACK");
      }
      if (loseNext === name) {
        loseNext = undefined;
        throw new Error("socket hang up");
      }
      return { ...meta, ...output };
    }) as DataApiSender["send"],
  };

  const db: Db = {
    withConnection: (use) =>
      use({ query: async (text, params) => pglite.query(text, [...(params ?? [])]) }),
    close: () => pglite.close(),
  };
  return { sender, db, commands, loseAnswerTo: (name: string) => void (loseNext = name) };
}
// #endregion fake

describe("the once runner over the Data API adapter", () => {
  let fake: Awaited<ReturnType<typeof fakeDataApi>>;
  beforeAll(async () => {
    fake = await fakeDataApi();
  });
  afterAll(() => fake.db.close());

  const appendOnce = (note: { owner: string; id: string }) =>
    onceFor(dataApi(fake.sender, target)).once(
      { owner: note.owner, key: "key-1", result: appendResultSchema },
      (tx) => appendToNote(tx, { ...note, text: "b", at: AT }),
    );

  it("runs the same SQL as the session-based path", async () => {
    const note = await seedNote(fake.db);
    fake.commands.length = 0;

    expect(await appendOnce(note)).toEqual({ status: "appended", version: 2, length: 2 });

    expect(fake.commands).toEqual([
      "BeginTransactionCommand",
      "ExecuteStatementCommand",
      "ExecuteStatementCommand",
      "ExecuteStatementCommand",
      "CommitTransactionCommand",
    ]);
    expect(await stored(fake.db, note)).toEqual({ body: "ab", version: 2, requests: 1 });
  });

  // #region lost-commit
  it("applies once when the answer to CommitTransaction never arrives", async () => {
    const note = await seedNote(fake.db);
    fake.loseAnswerTo("CommitTransactionCommand");

    expect(await appendOnce(note)).toEqual({ status: "appended", version: 2, length: 2 });

    expect(await stored(fake.db, note)).toEqual({ body: "ab", version: 2, requests: 1 });
  });
  // #endregion lost-commit

  it("rolls back and starts over when a statement's answer is lost mid-transaction", async () => {
    const note = await seedNote(fake.db);
    fake.commands.length = 0;
    fake.loseAnswerTo("ExecuteStatementCommand");

    expect(await appendOnce(note)).toEqual({ status: "appended", version: 2, length: 2 });

    expect(fake.commands.slice(0, 3)).toEqual([
      "BeginTransactionCommand",
      "ExecuteStatementCommand",
      "RollbackTransactionCommand",
    ]);
    expect(await stored(fake.db, note)).toEqual({ body: "ab", version: 2, requests: 1 });
  });
});

describe("the PGlite stand-in", () => {
  it("has the schema the real cluster is given", async () => {
    const db = await migratedDb();
    const note = await seedNote(db);
    expect(await stored(db, note)).toEqual({ body: "a", version: 1, requests: 0 });
    await db.close();
  });
});
