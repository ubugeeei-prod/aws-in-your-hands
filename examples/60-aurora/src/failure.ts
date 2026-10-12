import { sqlStateOf } from "@aih/example-13-sql/src/db.ts";

// #region classify
/** Thrown by an adapter when the session itself is gone and no answer came back. */
export class ConnectionLostError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "ConnectionLostError";
  }
}

export type Failure = "conflict" | "connection" | "read_only" | "other";

// SQLSTATE values from PostgreSQL's Appendix A. Everything but "other" says
// the same thing to the caller: this attempt did not finish, start it again.
export function classify(error: unknown): Failure {
  if (error instanceof ConnectionLostError) {
    return "connection";
  }
  const state = sqlStateOf(error);
  if (state === undefined) {
    return "other";
  }
  // serialization_failure, deadlock_detected
  if (state === "40001" || state === "40P01") {
    return "conflict";
  }
  // read_only_sql_transaction: the session is on an instance that is no longer the writer.
  if (state === "25006") {
    return "read_only";
  }
  // Class 08 is connection exceptions; 57P01 to 57P03 are admin_shutdown,
  // crash_shutdown and cannot_connect_now.
  if (state.startsWith("08") || ["57P01", "57P02", "57P03"].includes(state)) {
    return "connection";
  }
  return "other";
}
// #endregion classify
