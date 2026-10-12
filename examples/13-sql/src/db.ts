import { z } from "zod";

// #region db
export type QueryResult = { rows: unknown[] };

/** One database session. `$1`-style parameters only: values never go into the SQL text. */
export type Queryable = {
  query(text: string, params?: readonly unknown[]): Promise<QueryResult>;
};

export type Db = {
  /** Holds one session for the whole callback, so BEGIN and COMMIT reach the same one. */
  withConnection<T>(use: (connection: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
// #endregion db

// #region rows
// A row is data from outside the type system, like an HTTP body. A column
// renamed by a migration fails here, by name, and not somewhere downstream.
export async function rows<Row>(
  connection: Queryable,
  schema: z.ZodType<Row>,
  text: string,
  params: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await connection.query(text, params);
  return z.array(schema).parse(result.rows);
}
// #endregion rows

const sqlStateSchema = z.object({ code: z.string().length(5) });

/** The five-character SQLSTATE of a database error, if `error` is one. */
export function sqlStateOf(error: unknown): string | undefined {
  const parsed = sqlStateSchema.safeParse(error);
  return parsed.success ? parsed.data.code : undefined;
}
