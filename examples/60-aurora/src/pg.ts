import pg from "pg";

import type { Db } from "@aih/example-13-sql/src/db.ts";

import { classify, ConnectionLostError } from "./failure.ts";

export type AuroraOptions = {
  /** The cluster endpoint: `<name>.cluster-<id>.<region>.rds.amazonaws.com`. */
  host: string;
  database: string;
  user: string;
  /** Read again for every new connection, so a rotated password is picked up. */
  password: () => Promise<string>;
  /** PEM of the certificate bundle AWS publishes for the Region. */
  ca: string;
  onPoolError: (error: Error) => void;
};

// #region pool
/** node-postgres against the cluster endpoint, for code that runs inside the VPC. */
export function openAurora(options: AuroraOptions): Db {
  const pool = new pg.Pool({
    host: options.host,
    port: 5432,
    database: options.database,
    user: options.user,
    password: options.password,
    ssl: { ca: options.ca, rejectUnauthorized: true },
    // An instance that scaled to zero takes about 15 seconds to resume, and
    // 30 or more after a day asleep.
    connectionTimeoutMillis: 35_000,
    // Without keepalive, a session to an instance that vanished waits on a
    // socket nobody will ever write to.
    keepAlive: true,
    keepAliveInitialDelayMillis: 1_000,
    // An idle session also keeps the instance from pausing.
    idleTimeoutMillis: 10_000,
    max: 1,
  });
  pool.on("error", options.onPoolError);

  return {
    async withConnection(use) {
      let client: pg.PoolClient;
      try {
        client = await pool.connect();
      } catch (error) {
        // A refused password is an answer. A timeout or a reset is not.
        if (error instanceof pg.DatabaseError) {
          throw error;
        }
        throw new ConnectionLostError("Could not connect to the cluster endpoint.", error);
      }
      let discard = false;
      try {
        return await use({
          async query(text, params) {
            try {
              return { rows: (await client.query(text, [...(params ?? [])])).rows };
            } catch (error) {
              if (!(error instanceof pg.DatabaseError)) {
                // No answer from the server: the socket closed or timed out.
                discard = true;
                throw new ConnectionLostError("The session ended without an answer.", error);
              }
              // A session on a demoted writer still answers, but must not be
              // reused: only a new connection looks the endpoint's name up again.
              discard ||= ["connection", "read_only"].includes(classify(error));
              throw error;
            }
          },
        });
      } finally {
        client.release(discard);
      }
    },
    close: () => pool.end(),
  };
}
// #endregion pool
