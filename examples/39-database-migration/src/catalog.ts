import * as v from "valibot";

import { type Queryable, rows } from "@aih/example-13-sql/src/db.ts";

// #region types
export type TableRef = { schema: string; name: string };

export type Column = {
  name: string;
  /** `information_schema.columns.data_type`: "text", "character varying", "uuid", ... */
  type: string;
  /** The declared length of a character type, or null when it has none. */
  maxLength: number | null;
  /** Filled by a sequence: an identity column, or a default that calls `nextval`. */
  generated: boolean;
};

export type Table = TableRef & { columns: Column[]; primaryKey: string[] };
// #endregion types

export const qualified = (table: TableRef): string => `${quote(table.schema)}.${quote(table.name)}`;

/** An identifier, quoted. Names come from the catalog, never from a request. */
export function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

const columnRow = v.object({
  table_schema: v.string(),
  table_name: v.string(),
  column_name: v.string(),
  data_type: v.string(),
  character_maximum_length: v.nullable(v.pipe(v.number(), v.integer())),
  generated: v.boolean(),
});

const keyRow = v.object({
  table_schema: v.string(),
  table_name: v.string(),
  column_name: v.string(),
});

// #region read
/** The base tables of the given schemas, with their columns and primary keys, in name order. */
export async function readCatalog(connection: Queryable, schemas: string[]): Promise<Table[]> {
  const columns = await rows(
    connection,
    columnRow,
    `SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
            c.character_maximum_length::integer AS character_maximum_length,
            (c.is_identity = 'YES' OR coalesce(c.column_default, '') LIKE 'nextval(%') AS generated
       FROM information_schema.columns c
       JOIN information_schema.tables t USING (table_schema, table_name)
      WHERE t.table_type = 'BASE TABLE' AND c.table_schema = ANY($1::text[])
      ORDER BY c.table_schema, c.table_name, c.ordinal_position`,
    [schemas],
  );
  const keys = await rows(
    connection,
    keyRow,
    `SELECT k.table_schema, k.table_name, k.column_name
       FROM information_schema.table_constraints t
       JOIN information_schema.key_column_usage k USING (constraint_schema, constraint_name)
      WHERE t.constraint_type = 'PRIMARY KEY' AND k.table_schema = ANY($1::text[])
      ORDER BY k.table_schema, k.table_name, k.ordinal_position`,
    [schemas],
  );

  const tables = new Map<string, Table>();
  for (const row of columns) {
    const id = `${row.table_schema}.${row.table_name}`;
    const table = tables.get(id) ?? {
      schema: row.table_schema,
      name: row.table_name,
      columns: [],
      primaryKey: [],
    };
    table.columns.push({
      name: row.column_name,
      type: row.data_type,
      maxLength: row.character_maximum_length,
      generated: row.generated,
    });
    tables.set(id, table);
  }
  for (const row of keys) {
    tables.get(`${row.table_schema}.${row.table_name}`)?.primaryKey.push(row.column_name);
  }
  return [...tables.values()];
}
// #endregion read

const objectRow = v.object({ kind: v.string(), name: v.string() });

// #region secondary
/**
 * What a row-by-row copy does not bring: indexes, and every constraint that is
 * not a primary key. Named `kind table.name`, so two schemas can be compared.
 */
export async function readSecondaryObjects(
  connection: Queryable,
  schema: string,
): Promise<string[]> {
  const found = await rows(
    connection,
    objectRow,
    `SELECT 'index' AS kind, tablename || '.' || indexname AS name
       FROM pg_indexes i
      WHERE schemaname = $1
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = i.indexname AND c.contype = 'p')
      UNION ALL
     SELECT CASE c.contype WHEN 'f' THEN 'foreign key' WHEN 'c' THEN 'check' ELSE 'unique' END,
            r.relname || '.' || c.conname
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = $1 AND c.contype IN ('f', 'c', 'u')
      ORDER BY 1, 2`,
    [schema],
  );
  return found.map((object) => `${object.kind} ${object.name}`);
}
// #endregion secondary
