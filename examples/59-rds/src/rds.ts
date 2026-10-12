import { Signer } from "@aws-sdk/rds-signer";
import pg from "pg";

import type { Db } from "@aih/example-13-sql/src/db.ts";

export type RdsOptions = {
  /** The instance endpoint, `<id>.<hash>.<region>.rds.amazonaws.com`. Never an IP address. */
  host: string;
  port: number;
  database: string;
  user: string;
  /** Called for every new connection. */
  password: () => Promise<string>;
  onPoolError: (error: Error) => void;
};

// #region token
/**
 * A password for one database user that expires 15 minutes after signing.
 * Signing is arithmetic on the caller's AWS credentials: no request leaves the
 * function, which matters in a subnet with no route to any AWS API.
 */
export function iamToken(target: {
  host: string;
  port: number;
  user: string;
  region: string;
}): () => Promise<string> {
  const signer = new Signer({
    hostname: target.host,
    port: target.port,
    username: target.user,
    region: target.region,
  });
  return () => signer.getAuthToken();
}
// #endregion token

// #region pool
export function openRds(options: RdsOptions): Db {
  const pool = new pg.Pool({
    host: options.host,
    port: options.port,
    database: options.database,
    user: options.user,
    password: options.password,
    // Checks the chain and the host name. The Amazon RDS root certificates are
    // not in Node's own store: NODE_EXTRA_CA_CERTS names the file that has them.
    ssl: { rejectUnauthorized: true },
    // A Lambda execution environment serves one request at a time.
    max: 1,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 5000,
  });
  // A failover or a restart kills idle connections. Unhandled, the event ends the process.
  pool.on("error", options.onPoolError);

  return {
    async withConnection(use) {
      const client = await pool.connect();
      let broken = false;
      try {
        return await use({
          query: async (text, params) => ({
            rows: (await client.query(text, [...(params ?? [])])).rows,
          }),
        });
      } catch (error) {
        // An error the database answered with leaves the session usable. After
        // anything else the connection is dropped, so the next one resolves the
        // endpoint again and reaches whichever instance is the primary now.
        broken = !(error instanceof pg.DatabaseError);
        throw error;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
// #endregion pool
