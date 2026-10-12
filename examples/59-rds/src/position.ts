import * as v from "valibot";

import { type Db, rows } from "@aih/example-13-sql/src/db.ts";

import { type Lsn, lsnColumnSchema } from "./lsn.ts";

// #region position
/** How far the primary has written, and how far the replica has replayed. */
export type ReplicationPosition = {
  /** Everything committed before this call lies at or before the answer. */
  written(): Promise<Lsn>;
  /** `undefined` when the replica cannot say. The caller then reads the primary. */
  replayed(): Promise<Lsn | undefined>;
};

const lsnRowSchema = v.object({ lsn: lsnColumnSchema });

export async function writtenLsn(primary: Db): Promise<Lsn> {
  const [row] = await primary.withConnection((connection) =>
    // Refused on a server in recovery, so a promoted or mistaken endpoint fails loudly.
    rows(connection, lsnRowSchema, "SELECT pg_current_wal_lsn()::text AS lsn"),
  );
  if (row?.lsn === undefined) {
    throw new Error("The primary did not report a write-ahead log position.");
  }
  return row.lsn;
}

export async function replayedLsn(replica: Db): Promise<Lsn | undefined> {
  const [row] = await replica.withConnection((connection) =>
    // NULL on a server that is not replaying a log, which is not a replica.
    rows(connection, lsnRowSchema, "SELECT pg_last_wal_replay_lsn()::text AS lsn"),
  );
  return row?.lsn;
}

/** Both positions asked of real servers: the writer instance and one read replica. */
export const postgresPosition = (primary: Db, replica: Db): ReplicationPosition => ({
  written: () => writtenLsn(primary),
  replayed: () => replayedLsn(replica),
});
// #endregion position
