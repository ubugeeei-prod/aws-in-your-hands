import pg from "pg";

import type { Db } from "@aih/example-13-sql/src/db.ts";

import { createFailover, type Endpoint } from "./failover.ts";

export type YugabyteOptions = {
  /** The YSQL listener of every node. Any of them can serve any statement. */
  endpoints: readonly Endpoint[];
  database: string;
  user: string;
  password?: string;
  /** The cluster's `ca.crt`. Unset only for a cluster on loopback without TLS. */
  ca?: string;
  onSkip?: (info: { endpoint: Endpoint; error: unknown }) => void;
};

// #region open
/** Chapter 13's `Db`, over a YugabyteDB cluster. The repository on top of it does not change. */
export function openYugabyte(options: YugabyteOptions): Db {
  const failover = createFailover(
    options.endpoints,
    async (endpoint) => {
      const client = new pg.Client({
        host: endpoint.host,
        port: endpoint.port,
        database: options.database,
        user: options.user,
        password: options.password,
        // The nodes' certificates name their addresses, and the CA is the cluster's own.
        ssl: options.ca === undefined ? false : { ca: options.ca, rejectUnauthorized: true },
        // A dead node must cost a moment, not the operating system's TCP timeout.
        connectionTimeoutMillis: 2_000,
      });
      // A node that dies under an idle session emits here. Unhandled, it would end the process.
      client.on("error", () => undefined);
      await client.connect();
      return client;
    },
    options.onSkip,
  );

  return {
    async withConnection(use) {
      const { session } = await failover.open();
      try {
        return await use({
          query: async (text, params) => ({
            rows: (await session.query(text, [...(params ?? [])])).rows,
          }),
        });
      } finally {
        // One session per unit of work: simple, and a session never outlives the node it was on.
        await session.end().catch(() => undefined);
      }
    },
    close: () => Promise.resolve(),
  };
}
// #endregion open
