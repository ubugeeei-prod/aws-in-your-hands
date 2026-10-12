import { createHash } from "node:crypto";

import type { ObjectEntry } from "./plan.ts";

type Stored = { body: Uint8Array; lastModified: Date };

// #region memory-bucket
/**
 * A bucket without versioning, in memory. A put replaces the whole object at
 * once, as in S3: a reader sees the old bytes or the new ones, never a mix.
 */
export class MemoryBucket {
  readonly #objects = new Map<string, Stored>();
  readonly #now: () => Date;
  /** Every write and delete, in order. Tests count these. */
  readonly operations: { kind: "put" | "delete"; key: string }[] = [];

  constructor(now: () => Date) {
    this.#now = now;
  }

  put(key: string, body: Uint8Array | string): void {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    this.#objects.set(key, { body: bytes, lastModified: this.#now() });
    this.operations.push({ kind: "put", key });
  }

  get(key: string): Uint8Array | undefined {
    return this.#objects.get(key)?.body;
  }

  delete(key: string): void {
    this.#objects.delete(key);
    this.operations.push({ kind: "delete", key });
  }

  list(): ObjectEntry[] {
    return [...this.#objects.entries()]
      .map(([key, stored]) => ({
        key,
        size: stored.body.byteLength,
        checksum: checksumOf(stored.body),
        lastModified: stored.lastModified.toISOString(),
      }))
      .toSorted((a, b) => (a.key < b.key ? -1 : 1));
  }
}
// #endregion memory-bucket

export function checksumOf(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}
