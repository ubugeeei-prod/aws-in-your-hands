import { Cluster, Redis } from "iovalkey";
import { type AwsCredentials, elastiCacheAuthToken } from "./elasticache-token.ts";
import type { ValkeyCommands, ValkeyProvider } from "./valkey-store.ts";

export type Opened = { commands: ValkeyCommands; close: () => void };

// #region deadline
/**
 * A cache that does not answer must not hold the request until Lambda's
 * timeout: every command gives up after `timeoutMs` and the caller moves on.
 */
export function withDeadline(client: Redis | Cluster, timeoutMs: number): ValkeyCommands {
  const within = async <T>(command: Promise<T>): Promise<T> => {
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Valkey did not answer within ${timeoutMs} ms`)), timeoutMs);
    });
    try {
      return await Promise.race([command, deadline]);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    get: (key) => within(client.get(key)),
    set: (key: string, value: string, token: "PXAT", at: number, nx?: "NX") =>
      within(nx === undefined ? client.set(key, value, token, at) : client.set(key, value, token, at, nx)),
    del: (key) => within(client.del(key)),
    eval: (script, numberOfKeys, ...args) => within(client.eval(script, numberOfKeys, ...args)),
  };
}
// #endregion deadline

/** A plain Valkey on your machine: no TLS, no password, no cluster mode. */
export function openLocalValkey(url: string, timeoutMs: number): Opened {
  const client = new Redis(url, { maxRetriesPerRequest: 1 });
  // Without a listener, a refused connection would end the process.
  client.on("error", () => {});
  return { commands: withDeadline(client, timeoutMs), close: () => client.disconnect() };
}

export type ElastiCacheOptions = {
  endpoint: string;
  port: number;
  cacheName: string;
  userId: string;
  region: string;
  credentials: AwsCredentials | (() => Promise<AwsCredentials>);
  timeoutMs: number;
  now: () => Date;
  onError: (error: Error) => void;
};

// #region elasticache
export async function openElastiCache(options: ElastiCacheOptions): Promise<Opened> {
  // There is no password to store. The token is signed here, with the
  // execution role's credentials, and is good for 15 minutes.
  const token = await elastiCacheAuthToken({ ...options, now: options.now() });
  // ElastiCache Serverless speaks cluster mode only, behind one endpoint.
  const cluster = new Cluster([{ host: options.endpoint, port: options.port }], {
    // Keep the host name through the lookup, so the certificate is checked against it.
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: {
      username: options.userId,
      password: token,
      // A public endpoint accepts nothing older.
      tls: { minVersion: "TLSv1.3" },
      connectTimeout: options.timeoutMs,
      maxRetriesPerRequest: 1,
    },
  });
  cluster.on("error", options.onError);
  return { commands: withDeadline(cluster, options.timeoutMs), close: () => cluster.disconnect() };
}
// #endregion elasticache

// #region rotating
/**
 * Replaces the connection once it is `maxAgeMs` old. iovalkey takes the
 * password as a fixed string, so a reconnect after the token's 15 minutes
 * would be refused; a fresh client signs a fresh token instead.
 */
export function rotating(options: {
  open: () => Promise<Opened>;
  maxAgeMs: number;
  now: () => number;
}): ValkeyProvider {
  let current: { opened: Promise<Opened>; at: number } | undefined;
  return async () => {
    const now = options.now();
    if (current === undefined || now - current.at >= options.maxAgeMs) {
      const previous = current;
      current = { opened: options.open(), at: now };
      previous?.opened.then(
        (old) => old.close(),
        () => {},
      );
    }
    const mine = current;
    try {
      return (await mine.opened).commands;
    } catch (error) {
      // A failed open is not kept: the next request tries again.
      if (current === mine) {
        current = undefined;
      }
      throw error;
    }
  };
}
// #endregion rotating
