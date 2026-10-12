import * as v from "valibot";

import type { SigningKey } from "./token.ts";

export const STAGES = ["AWSCURRENT", "AWSPREVIOUS"] as const;
export type Stage = (typeof STAGES)[number];

// #region source
/** Where the signing secret lives. `null`: no version carries that staging label. */
export type SecretSource = { read(stage: Stage): Promise<SigningKey | null> };

/** The service refused the caller. Right after a deploy this can be IAM still propagating. */
export class SecretAccessDenied extends Error {
  override name = "SecretAccessDenied";
}
// #endregion source

// #region payload
/** What is stored as the secret string. Parsed on every read: the store is outside the type system. */
export const secretPayloadSchema = v.object({
  // Characters, not v.minLength's UTF-16 units: 16 emoji are 32 units.
  key: v.pipe(
    v.string(),
    v.check((key) => [...key].length >= 32, "at least 32 characters"),
  ),
});

export function parseSecretString(secretString: string): string {
  let json: unknown;
  try {
    json = JSON.parse(secretString);
  } catch {
    // Never echo the value: this message ends up in logs.
    throw new Error("secret value is not JSON");
  }
  const parsed = v.safeParse(secretPayloadSchema, json);
  if (!parsed.success) {
    throw new Error("secret value has no usable `key` (a string of at least 32 characters)");
  }
  return parsed.output.key;
}
// #endregion payload

export type MemoryVersion = { versionId: string; key: string; createdAt: Date };

/** Secrets Manager's labels in memory, for the local server and the tests. */
export class MemorySecretStore implements SecretSource {
  readonly versions: MemoryVersion[] = [];
  private readonly labels = new Map<Stage, string>();
  reads = 0;

  constructor(first: MemoryVersion) {
    this.versions.push(first);
    this.labels.set("AWSCURRENT", first.versionId);
  }

  async read(stage: Stage): Promise<SigningKey | null> {
    this.reads += 1;
    const version = this.versions.find(
      (candidate) => candidate.versionId === this.labels.get(stage),
    );
    return version === undefined ? null : { versionId: version.versionId, key: version.key };
  }

  stageOf(versionId: string): Stage[] {
    return STAGES.filter((stage) => this.labels.get(stage) === versionId);
  }

  /** PutSecretValue without VersionStages: the new version becomes current, the old current becomes previous. */
  put(version: MemoryVersion): void {
    const existing = this.versions.find((candidate) => candidate.versionId === version.versionId);
    if (existing !== undefined) {
      if (existing.key !== version.key) {
        throw Object.assign(new Error("a version with this token exists with a different value"), {
          name: "ResourceExistsException",
        });
      }
      return;
    }
    const previous = this.labels.get("AWSCURRENT");
    this.versions.push(version);
    this.labels.set("AWSCURRENT", version.versionId);
    if (previous !== undefined) {
      this.labels.set("AWSPREVIOUS", previous);
    }
  }
}
