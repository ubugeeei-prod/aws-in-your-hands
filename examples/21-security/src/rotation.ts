export type SecretVersion = { versionId: string; stages: string[]; createdAt: Date };

/** The two Secrets Manager calls a rotation needs. */
export type RotationApi = {
  versions(): Promise<SecretVersion[]>;
  /** Creates version `versionId` and makes it current. The same id and value again changes nothing. */
  put(versionId: string, key: string): Promise<void>;
};

export type RotationInput = {
  /** Becomes the new version's id, and makes a retry of this run harmless. */
  versionId: string;
  newKey: string;
  now: Date;
  /** Token lifetime plus the longest a key cache may lag: how long the outgoing key must stay accepted. */
  overlapMs: number;
  force?: boolean;
};

export type RotationResult =
  | { status: "rotated" | "already-rotated"; current: string; previous: string | null }
  | { status: "too-soon"; current: string; waitMs: number };

const holder = (versions: SecretVersion[], stage: string): SecretVersion | undefined =>
  versions.find((version) => version.stages.includes(stage));

// #region rotate
export async function rotate(api: RotationApi, input: RotationInput): Promise<RotationResult> {
  const before = await api.versions();
  const current = holder(before, "AWSCURRENT");
  if (current === undefined) {
    throw new Error("the secret has no AWSCURRENT version; refusing to guess");
  }
  // An earlier run got this far and lost the response. Nothing left to do.
  if (current.versionId === input.versionId) {
    return {
      status: "already-rotated",
      current: current.versionId,
      previous: holder(before, "AWSPREVIOUS")?.versionId ?? null,
    };
  }

  // Rotating again moves AWSPREVIOUS off the key that unexpired tokens were signed with.
  const age = input.now.getTime() - current.createdAt.getTime();
  if (age < input.overlapMs && input.force !== true) {
    return { status: "too-soon", current: current.versionId, waitMs: input.overlapMs - age };
  }

  await api.put(input.versionId, input.newKey);

  // Read back instead of trusting the call: the labels are what the verifiers will see.
  const after = await api.versions();
  const nowCurrent = holder(after, "AWSCURRENT")?.versionId;
  const nowPrevious = holder(after, "AWSPREVIOUS")?.versionId ?? null;
  if (nowCurrent !== input.versionId || nowPrevious !== current.versionId) {
    throw new Error(
      `after PutSecretValue, AWSCURRENT is ${nowCurrent} and AWSPREVIOUS is ${nowPrevious}; ` +
        `expected ${input.versionId} and ${current.versionId}`,
    );
  }
  return { status: "rotated", current: input.versionId, previous: current.versionId };
}
// #endregion rotate
