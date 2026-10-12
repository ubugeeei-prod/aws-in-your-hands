// Two buckets with versioning and a replication rule between them, in memory.
// Each rule below is one sentence of the S3 documentation; nothing about how
// long replication takes is modelled except a fixed delay.

// #region bucket
export type ReplicationStatus = "PENDING" | "COMPLETED" | "REPLICA";

export type StoredVersion = {
  key: string;
  versionId: string;
  /** Absent on a delete marker. */
  body?: Uint8Array | undefined;
  /** Absent when no rule applied to this version. */
  replicationStatus?: ReplicationStatus | undefined;
};

export class BucketModel {
  readonly name: string;
  /** Per key, oldest first. */
  readonly #versions = new Map<string, StoredVersion[]>();
  #counter = 0;
  /** Told about every version this bucket creates itself. Replicas are not announced. */
  onCreated: (version: StoredVersion) => void = () => {};

  constructor(name: string) {
    this.name = name;
  }

  #push(version: StoredVersion): StoredVersion {
    this.#versions.set(version.key, [...(this.#versions.get(version.key) ?? []), version]);
    return version;
  }

  put(key: string, body: Uint8Array): StoredVersion {
    const version = this.#push({ key, versionId: `${this.name}.${++this.#counter}`, body });
    this.onCreated(version);
    return version;
  }

  /** A delete without a version ID: nothing is removed, a delete marker goes on top. */
  delete(key: string): StoredVersion {
    const marker = this.#push({ key, versionId: `${this.name}.${++this.#counter}` });
    this.onCreated(marker);
    return marker;
  }

  /** A delete with a version ID: that version is gone for good. */
  deleteVersion(key: string, versionId: string): void {
    const left = (this.#versions.get(key) ?? []).filter(
      (version) => version.versionId !== versionId,
    );
    this.#versions.set(key, left);
  }

  /** Receives a copy with the source's version ID. */
  receive(version: StoredVersion): void {
    if (!this.versions(version.key).some((held) => held.versionId === version.versionId)) {
      this.#push({ ...version, replicationStatus: "REPLICA" });
    }
  }

  versions(key: string): readonly StoredVersion[] {
    return this.#versions.get(key) ?? [];
  }

  /** What GetObject answers: the newest version, unless that is a delete marker. */
  current(key: string): Uint8Array | undefined {
    return this.versions(key).at(-1)?.body;
  }
}
// #endregion bucket

export type ReplicationRule = {
  /** Off by default in S3, and off here. */
  deleteMarkers: boolean;
  lagMs: number;
};

type Pending = { version: StoredVersion; dueAt: number };

// #region replication
/** One direction. Two-way replication is two of these. */
export class Replication {
  readonly #destination: BucketModel;
  readonly #rule: ReplicationRule;
  #pending: Pending[] = [];
  #now = 0;
  #paused = false;

  constructor(source: BucketModel, destination: BucketModel, rule: ReplicationRule) {
    this.#destination = destination;
    this.#rule = rule;
    // Only what is created from now on. Objects already in the bucket stay
    // where they are; S3 Batch Replication is the separate tool for them.
    source.onCreated = (version) => {
      if (version.body === undefined && !rule.deleteMarkers) {
        return;
      }
      version.replicationStatus = "PENDING";
      this.#pending.push({ version, dueAt: this.#now + this.#rule.lagMs });
    };
    // `deleteVersion` on the source is never forwarded: S3 does not replicate
    // a delete that names a version. A replica is not replicated onward either,
    // because `receive` does not announce it.
  }

  /** The Regions cannot talk. Uploads to the source still succeed. */
  pause(): void {
    this.#paused = true;
  }

  resume(): void {
    this.#paused = false;
    this.advance(0);
  }

  advance(ms: number): void {
    this.#now += ms;
    if (this.#paused) {
      return;
    }
    const waiting: Pending[] = [];
    for (const entry of this.#pending) {
      if (entry.dueAt > this.#now) {
        waiting.push(entry);
        continue;
      }
      this.#destination.receive(entry.version);
      entry.version.replicationStatus = "COMPLETED";
    }
    this.#pending = waiting;
  }

  get pending(): number {
    return this.#pending.length;
  }
}
// #endregion replication
