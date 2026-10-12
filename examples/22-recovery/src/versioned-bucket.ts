import { createHash } from "node:crypto";

import type { ObjectStore } from "@aih/example-07-uploads/api/src/object-store.ts";
import type { ObjectReader, ReadResult } from "@aih/example-08-async/src/object-reader.ts";

// #region port
export type ObjectVersion = {
  key: string;
  versionId: string;
  /** A delete marker has no bytes: it only says "deleted here". */
  deleteMarker: boolean;
  isLatest: boolean;
  lastModified: Date;
  /** Absent on a delete marker. */
  eTag?: string | undefined;
};

export type CurrentObject = { key: string; eTag: string; size: number; lastModified: Date };

/** What a restore needs from a bucket with versioning turned on. */
export type VersionedBucket = {
  /** Every version and delete marker under the prefix, in no promised order. */
  listVersions(prefix: string): AsyncIterable<ObjectVersion>;
  /** Removes exactly this version or delete marker, for good. */
  removeVersion(key: string, versionId: string): Promise<void>;
  /** Copies an old version on top. Nothing is removed: the copy becomes the current version. */
  copyVersion(key: string, versionId: string): Promise<void>;
  /** What a plain listing shows: keys whose current version is not a delete marker. */
  listCurrent(prefix: string): AsyncIterable<CurrentObject>;
};
// #endregion port

type Stored = {
  versionId: string;
  lastModified: Date;
  object: { body: Uint8Array; contentType: string; eTag: string; pending: boolean } | undefined;
};

// #region memory-bucket
/**
 * A bucket with versioning, in memory. It follows the three rules of S3 that
 * the restore depends on: a write adds a version, a delete without a version
 * ID adds a delete marker, and a delete with a version ID really deletes.
 */
export class MemoryVersionedBucket implements ObjectStore, ObjectReader, VersionedBucket {
  /** Per key, oldest first. */
  readonly #versions = new Map<string, Stored[]>();
  readonly #now: () => Date;
  #counter = 0;

  constructor(now: () => Date) {
    this.#now = now;
  }

  #push(key: string, object: Stored["object"]): void {
    const versions = this.#versions.get(key) ?? [];
    versions.push({ versionId: `v${++this.#counter}`, lastModified: this.#now(), object });
    this.#versions.set(key, versions);
  }

  #current(key: string): NonNullable<Stored["object"]> | undefined {
    return this.#versions.get(key)?.at(-1)?.object;
  }

  /** The browser's upload: arrives pending, as in chapter 07. */
  put(key: string, body: Uint8Array, contentType: string): void {
    this.#push(key, {
      body,
      contentType,
      eTag: createHash("md5").update(body).digest("hex"),
      pending: true,
    });
  }

  async presignUpload(input: { key: string; contentType: string }) {
    return {
      url: "memory://uploads",
      fields: { key: input.key, "Content-Type": input.contentType },
    };
  }

  async head(key: string) {
    const version = this.#versions.get(key)?.at(-1);
    return version?.object === undefined
      ? undefined
      : {
          size: version.object.body.byteLength,
          contentType: version.object.contentType,
          lastModified: version.lastModified,
        };
  }

  async markAttached(key: string) {
    const current = this.#current(key);
    if (current === undefined) {
      throw new Error(`NoSuchKey: ${key}`);
    }
    current.pending = false;
  }

  async presignView(key: string) {
    return `memory://uploads/${key}`;
  }

  async delete(key: string) {
    this.#push(key, undefined);
  }

  async *list(prefix: string) {
    for await (const object of this.listCurrent(prefix)) {
      yield { key: object.key, lastModified: object.lastModified };
    }
  }

  async readExact(key: string, eTag: string, maxBytes: number): Promise<ReadResult> {
    const current = this.#current(key);
    if (current === undefined) {
      return { status: "gone" };
    }
    if (current.eTag !== eTag) {
      return { status: "changed" };
    }
    return {
      status: "found",
      bytes: current.body.subarray(0, maxBytes),
      size: current.body.byteLength,
      contentType: current.contentType,
    };
  }

  async *listCurrent(prefix: string) {
    for (const key of [...this.#versions.keys()].toSorted()) {
      const version = this.#versions.get(key)?.at(-1);
      if (key.startsWith(prefix) && version?.object !== undefined) {
        yield {
          key,
          eTag: version.object.eTag,
          size: version.object.body.byteLength,
          lastModified: version.lastModified,
        };
      }
    }
  }

  async *listVersions(prefix: string) {
    for (const [key, versions] of this.#versions) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      for (const [index, version] of versions.entries()) {
        yield {
          key,
          versionId: version.versionId,
          deleteMarker: version.object === undefined,
          isLatest: index === versions.length - 1,
          lastModified: version.lastModified,
          eTag: version.object?.eTag,
        };
      }
    }
  }

  async removeVersion(key: string, versionId: string) {
    const left = (this.#versions.get(key) ?? []).filter(
      (version) => version.versionId !== versionId,
    );
    if (left.length === 0) {
      this.#versions.delete(key);
    } else {
      this.#versions.set(key, left);
    }
  }

  async copyVersion(key: string, versionId: string) {
    const source = this.#versions
      .get(key)
      ?.find((version) => version.versionId === versionId)?.object;
    if (source === undefined) {
      throw new Error(`NoSuchVersion: ${key} ${versionId}`);
    }
    this.#push(key, { ...source });
  }
}
// #endregion memory-bucket
