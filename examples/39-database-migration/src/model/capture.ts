// A MODEL of change capture, written for this chapter. It is not AWS DMS and
// not logical decoding: PGlite runs with wal_level = replica and cannot create
// a logical replication slot, so row triggers write the log instead.

import * as v from "valibot";

import { type Queryable, rows } from "@aih/example-13-sql/src/db.ts";

import { type Table, qualified } from "../catalog.ts";

// #region change
const record = v.record(v.string(), v.unknown());

export const changeSchema = v.object({
  /** The position in the log. Changes are applied in this order. */
  lsn: v.pipe(v.number(), v.integer(), v.minValue(1)),
  schema: v.string(),
  table: v.string(),
  op: v.picklist(["insert", "update", "delete"]),
  /** The primary key of the row before the change. Null when the table has no primary key. */
  key: v.nullable(record),
  /** The whole row after the change. Null for a delete. */
  row: v.nullable(record),
});

export type Change = v.InferOutput<typeof changeSchema>;
// #endregion change

// #region install
const setup = [
  "CREATE SCHEMA IF NOT EXISTS capture_model",
  "CREATE SEQUENCE IF NOT EXISTS capture_model.lsn",
  `CREATE TABLE IF NOT EXISTS capture_model.log (
     lsn bigint PRIMARY KEY DEFAULT nextval('capture_model.lsn'),
     schema_name text NOT NULL, table_name text NOT NULL, op text NOT NULL, key jsonb, row jsonb)`,
  // Like the default replica identity: the old row is known by its primary key
  // only, and a table without one gives an update or a delete no key at all.
  `CREATE OR REPLACE FUNCTION capture_model.record() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE
     old_key jsonb := NULL;
     key_column text;
   BEGIN
     IF TG_NARGS > 0 THEN
       old_key := '{}'::jsonb;
       FOREACH key_column IN ARRAY TG_ARGV LOOP
         old_key := old_key || jsonb_build_object(
           key_column,
           (CASE WHEN TG_OP = 'INSERT' THEN to_jsonb(NEW) ELSE to_jsonb(OLD) END) -> key_column);
       END LOOP;
     END IF;
     INSERT INTO capture_model.log (schema_name, table_name, op, key, row)
     VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, lower(TG_OP), old_key,
             CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END);
     RETURN NULL;
   END $$`,
];

/** Starts recording every row change of `tables`. The model's stand-in for creating a slot. */
export async function installCapture(source: Queryable, tables: Table[]): Promise<void> {
  for (const statement of setup) {
    await source.query(statement);
  }
  for (const table of tables) {
    const keyColumns = table.primaryKey.map((column) => `'${column.replaceAll("'", "''")}'`);
    await source.query(`DROP TRIGGER IF EXISTS capture_model ON ${qualified(table)}`);
    await source.query(
      `CREATE TRIGGER capture_model AFTER INSERT OR UPDATE OR DELETE ON ${qualified(table)}
         FOR EACH ROW EXECUTE FUNCTION capture_model.record(${keyColumns.join(", ")})`,
    );
  }
}
// #endregion install

const lsnRow = v.object({ lsn: v.pipe(v.number(), v.integer()) });

/** The position of the newest recorded change, or 0. */
export async function currentLsn(source: Queryable): Promise<number> {
  const [row] = await rows(
    source,
    lsnRow,
    "SELECT coalesce(max(lsn), 0)::integer AS lsn FROM capture_model.log",
  );
  return row?.lsn ?? 0;
}

/** The recorded changes after `afterLsn`, oldest first. */
export async function readChanges(source: Queryable, afterLsn: number): Promise<Change[]> {
  return rows(
    source,
    changeSchema,
    `SELECT lsn::integer AS lsn, schema_name AS schema, table_name AS "table", op, key, row
       FROM capture_model.log WHERE lsn > $1 ORDER BY lsn`,
    [afterLsn],
  );
}
