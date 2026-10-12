import type { DigestStore, DigestVersion } from "./digest.ts";

type Version = { versionId: string; body?: string; retainUntil?: number };

/**
 * A model of one versioned S3 bucket with Object Lock and a default retention,
 * as the user guide describes them. It keeps the rules this chapter depends
 * on and nothing else: no legal holds, no event holds, no lifecycle, no IAM.
 */
export class MemoryDigests implements DigestStore {
  // Newest first, as ListObjectVersions returns them.
  readonly #objects = new Map<string, Version[]>();
  readonly #mode: "governance" | "compliance";
  readonly #retentionMs: number;
  readonly #now: () => Date;
  #issued = 0;

  constructor(options: {
    mode: "governance" | "compliance";
    retentionMs: number;
    now: () => Date;
  }) {
    this.#mode = options.mode;
    this.#retentionMs = options.retentionMs;
    this.#now = options.now;
  }

  #add(key: string, version: Omit<Version, "versionId">): void {
    this.#issued++;
    const versions = this.#objects.get(key) ?? [];
    this.#objects.set(key, [{ versionId: `v${this.#issued}`, ...version }, ...versions]);
  }

  // #region put
  /** PutObject with `If-None-Match: *`. */
  async put(key: string, body: string): Promise<"ok" | "exists"> {
    const current = this.#objects.get(key)?.[0];
    // A delete marker on top counts as "no object": the write goes through.
    if (current?.body !== undefined) {
      return "exists";
    }
    this.overwrite(key, body);
    return "ok";
  }

  /** PutObject without the header. A lock never stops this: it adds a version on top. */
  overwrite(key: string, body: string): void {
    this.#add(key, { body, retainUntil: this.#now().getTime() + this.#retentionMs });
  }
  // #endregion put

  // #region delete
  /** DeleteObject without a version ID: nothing is removed, a delete marker goes on top. */
  remove(key: string): void {
    this.#add(key, {});
  }

  /** DeleteObject with a version ID, which is the only request that removes data. */
  removeVersion(
    key: string,
    versionId: string,
    options: { bypass?: boolean } = {},
  ): "ok" | "locked" {
    const versions = this.#objects.get(key) ?? [];
    const target = versions.find((version) => version.versionId === versionId);
    const locked = target?.retainUntil !== undefined && target.retainUntil > this.#now().getTime();
    // Governance yields to s3:BypassGovernanceRetention. Compliance yields to nobody.
    if (locked && !(this.#mode === "governance" && options.bypass === true)) {
      return "locked";
    }
    this.#objects.set(
      key,
      versions.filter((version) => version !== target),
    );
    return "ok";
  }
  // #endregion delete

  async list(prefix: string): Promise<DigestVersion[]> {
    return [...this.#objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .flatMap(([key, versions]) =>
        versions.map(({ versionId, body }) => ({
          key,
          versionId,
          deleteMarker: body === undefined,
        })),
      );
  }

  async get(key: string, versionId: string): Promise<string> {
    const version = this.#objects.get(key)?.find((candidate) => candidate.versionId === versionId);
    if (version?.body === undefined) {
      throw new Error(`No object version ${versionId} at ${key}`);
    }
    return version.body;
  }
}
