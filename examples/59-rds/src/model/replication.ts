// A model of one primary and one read replica, for tests and the local server.
// It is not PostgreSQL replication. Both sides are real PostgreSQL (PGlite) and
// the positions are the primary's real ones, but what travels is the text of
// each committed statement, not the write-ahead log, and it travels only when
// `replay` is called.

import type { Db, Queryable } from "@aih/example-13-sql/src/db.ts";
import { openPglite } from "@aih/example-13-sql/src/pglite.ts";

import type { Lsn } from "../lsn.ts";
import { type ReplicationPosition, writtenLsn } from "../position.ts";

type Statement = { text: string; params: readonly unknown[] };
type Committed = { lsn: Lsn; statements: Statement[] };

export type ReplicationModel = {
  primary: Db;
  /** Answers queries, refuses writes, and knows nothing the log has not delivered. */
  replica: Db;
  position: ReplicationPosition;
  /** Commits on the primary that the replica has not applied yet. */
  lag(): number;
  /** Applies the oldest `count` of them, in commit order. All of them by default. */
  replay(count?: number): Promise<void>;
  /** Turns the replica into a standalone primary. What it had not replayed is gone. */
  promote(): Promise<Db>;
  close(): Promise<void>;
};

const READ_ONLY = /^\s*(SELECT|SHOW)\b/i;

// #region model
export async function createReplicationModel(
  options: { onCommit?: () => void } = {},
): Promise<ReplicationModel> {
  const primaryDb = await openPglite();
  const replicaDb = await openPglite();
  // What a hot standby does to every session: SQLSTATE 25006 on a write.
  await replicaDb.withConnection((connection) =>
    connection.query("SET default_transaction_read_only = on"),
  );

  const log: Committed[] = [];
  let replayed: Lsn = 0n;

  const commit = async (connection: Queryable, statements: Statement[]): Promise<void> => {
    if (statements.length === 0) {
      return;
    }
    const lsn = await writtenLsn({
      withConnection: (use) => use(connection),
      close: () => Promise.resolve(),
    });
    log.push({ lsn, statements });
    options.onCommit?.();
  };

  const primary: Db = {
    close: () => primaryDb.close(),
    withConnection: (use) =>
      primaryDb.withConnection((connection) => {
        let transaction: Statement[] | undefined;
        return use({
          async query(text, params = []) {
            const result = await connection.query(text, params);
            if (/^\s*BEGIN\b/i.test(text)) {
              transaction = [];
            } else if (/^\s*ROLLBACK\b/i.test(text)) {
              transaction = undefined;
            } else if (/^\s*COMMIT\b/i.test(text)) {
              const statements = transaction ?? [];
              transaction = undefined;
              await commit(connection, statements);
            } else if (!READ_ONLY.test(text)) {
              if (transaction === undefined) {
                await commit(connection, [{ text, params }]);
              } else {
                transaction.push({ text, params });
              }
            }
            return result;
          },
        });
      }),
  };

  return {
    primary,
    replica: replicaDb,
    position: {
      written: () => writtenLsn(primaryDb),
      replayed: () => Promise.resolve(replayed),
    },
    lag: () => log.length,
    async replay(count = log.length) {
      for (const entry of log.splice(0, count)) {
        await replicaDb.withConnection(async (connection) => {
          // Only the model's own applier may write here.
          await connection.query("BEGIN READ WRITE");
          for (const statement of entry.statements) {
            await connection.query(statement.text, statement.params);
          }
          await connection.query("COMMIT");
        });
        replayed = entry.lsn;
      }
    },
    async promote() {
      log.length = 0;
      await replicaDb.withConnection((connection) =>
        connection.query("SET default_transaction_read_only = off"),
      );
      return replicaDb;
    },
    async close() {
      await primaryDb.close();
      await replicaDb.close();
    },
  };
}
// #endregion model
