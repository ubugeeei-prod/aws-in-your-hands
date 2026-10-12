import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { Db } from "@aih/example-13-sql/src/db.ts";
import { openPglite } from "@aih/example-13-sql/src/pglite.ts";

import { formatLsn, laterOf, LSN_MAX, parseLsn } from "../src/lsn.ts";
import { replayedLsn, writtenLsn } from "../src/position.ts";

describe("log positions", () => {
  it("orders positions as numbers, not as text", () => {
    // As text, "9/0" sorts after "10/0" and "0/FFFFFFFF" after "1/0".
    expect(parseLsn("9/0")).toBeLessThan(parseLsn("10/0") ?? 0n);
    expect(parseLsn("0/FFFFFFFF")).toBeLessThan(parseLsn("1/0") ?? 0n);
    expect(parseLsn("16/B374D848")).toBe(0x16_b374_d848n);
  });

  it("prints a position the way PostgreSQL does", () => {
    for (const text of ["0/0", "0/16ED998", "16/B374D848", "FFFFFFFF/FFFFFFFF"]) {
      expect(formatLsn(parseLsn(text) ?? -1n)).toBe(text);
    }
    expect(formatLsn(LSN_MAX)).toBe("FFFFFFFF/FFFFFFFF");
  });

  it("refuses text that is not a position", () => {
    for (const text of ["", "0", "0/", "/0", "0/0/0", "-1/0", "0/G", "123456789/0", " 0/0"]) {
      expect(parseLsn(text), text).toBeUndefined();
    }
  });

  it("keeps the later of two positions, and a known one over none", () => {
    expect(laterOf(undefined, undefined)).toBeUndefined();
    expect(laterOf(5n, undefined)).toBe(5n);
    expect(laterOf(undefined, 5n)).toBe(5n);
    expect(laterOf(5n, 7n)).toBe(7n);
    expect(laterOf(7n, 5n)).toBe(7n);
  });
});

describe("positions asked of PostgreSQL", () => {
  let db: Db;
  beforeAll(async () => {
    db = await openPglite();
  }, 60_000);
  afterAll(() => db.close());

  it("moves forward when the primary writes, and not when it only reads", async () => {
    await db.withConnection((connection) => connection.query("CREATE TABLE t (n integer)"));
    const before = await writtenLsn(db);
    await db.withConnection((connection) => connection.query("SELECT count(*) FROM t"));
    expect(await writtenLsn(db)).toBe(before);
    await db.withConnection((connection) => connection.query("INSERT INTO t VALUES (1)"));
    expect(await writtenLsn(db)).toBeGreaterThan(before);
  });

  it("gets no replay position from a server that is not a replica", async () => {
    expect(await replayedLsn(db)).toBeUndefined();
  });
});
