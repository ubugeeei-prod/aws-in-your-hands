import { DsqlSigner } from "@aws-sdk/dsql-signer";
import pg from "pg";

import type { Db } from "./db.ts";

export type DsqlOptions = {
  /** `<cluster id>.dsql.<region>.on.aws` */
  endpoint: string;
  region: string;
  /** `admin`, or a database role that `AWS IAM GRANT` tied to the caller's IAM role. */
  user: string;
  onPoolError: (error: Error) => void;
};

// #region dsql
export function openDsql(options: DsqlOptions): Db {
  // Signing happens in this process, with whatever AWS credentials it runs
  // under: the execution role on Lambda, your own on a laptop.
  const signer = new DsqlSigner({ hostname: options.endpoint, region: options.region });

  const pool = new pg.Pool({
    host: options.endpoint,
    port: 5432,
    // A cluster has exactly one database, and this is its name.
    database: "postgres",
    user: options.user,
    // There is no password to store. Each new connection signs a fresh token;
    // `admin` needs the token of the other IAM action.
    password: () =>
      options.user === "admin"
        ? signer.getDbConnectAdminAuthToken()
        : signer.getDbConnectAuthToken(),
    // Checks the certificate chain and the host name against Node's CA store.
    ssl: { rejectUnauthorized: true },
    // A Lambda execution environment serves one request at a time.
    max: 1,
    // Aurora DSQL closes a connection after 60 minutes. Retire it first.
    maxLifetimeSeconds: 50 * 60,
    idleTimeoutMillis: 60_000,
    connectionTimeoutMillis: 10_000,
  });
  // An idle connection that dies emits here. Unhandled, it would end the process.
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
        // An error the database answered with leaves the session usable.
        // Anything else may have left it half-dead, so it is not reused.
        broken = !(error instanceof pg.DatabaseError);
        throw error;
      } finally {
        client.release(broken);
      }
    },
    close: () => pool.end(),
  };
}
// #endregion dsql
