import * as v from "valibot";

import { type Queryable, rows } from "@aih/example-13-sql/src/db.ts";

import { type TableRef, qualified, readSecondaryObjects } from "./catalog.ts";

const digest = v.object({
  n: v.pipe(v.number(), v.integer()),
  sum: v.string(),
});

// #region compare
export type TableCheck = {
  table: string;
  sourceRows: number;
  targetRows: number;
  match: boolean;
};

/**
 * One digest per table: every row as JSON, hashed, the hashes sorted and
 * hashed again. Needs no primary key and no row order. Both sessions must
 * print timestamps alike (same TimeZone), and the columns must be in the same
 * order. It reads each table whole and builds the digest in memory.
 */
async function tableDigest(
  connection: Queryable,
  table: TableRef,
): Promise<v.InferOutput<typeof digest>> {
  const [row] = await rows(
    connection,
    digest,
    `SELECT count(*)::integer AS n,
            md5(coalesce(string_agg(h, '' ORDER BY h), '')) AS sum
       FROM (SELECT md5(row_to_json(t)::text) AS h FROM ${qualified(table)} t) hashed`,
  );
  return row ?? { n: 0, sum: "" };
}

/** Counts and digests, table by table. Two separate reads: only meaningful once writes have stopped. */
export async function compareTables(
  source: Queryable,
  target: Queryable,
  pairs: { source: TableRef; target: TableRef }[],
): Promise<TableCheck[]> {
  const checks: TableCheck[] = [];
  for (const pair of pairs) {
    const before = await tableDigest(source, pair.source);
    const after = await tableDigest(target, pair.target);
    checks.push({
      table: `${pair.target.schema}.${pair.target.name}`,
      sourceRows: before.n,
      targetRows: after.n,
      match: before.n === after.n && before.sum === after.sum,
    });
  }
  return checks;
}
// #endregion compare

// #region objects
/**
 * Indexes and non-key constraints of the migrated tables that the source has
 * under a name the target lacks. Same name is all it checks, not same definition.
 */
export async function missingSecondaryObjects(
  source: { connection: Queryable; schema: string },
  target: { connection: Queryable; schema: string },
  tables: string[],
): Promise<string[]> {
  const migrated = new Set(tables);
  const present = new Set(await readSecondaryObjects(target.connection, target.schema));
  const tableOf = (object: string): string => (object.split(" ").at(-1) ?? "").split(".")[0] ?? "";
  return (await readSecondaryObjects(source.connection, source.schema)).filter(
    (object) => migrated.has(tableOf(object)) && !present.has(object),
  );
}
// #endregion objects
