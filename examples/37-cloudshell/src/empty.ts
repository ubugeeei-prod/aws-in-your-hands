import * as v from "valibot";

// Emptying a bucket before its stack is destroyed: every version and every delete marker,
// at most a thousand per request. The AWS calls come in through BucketIo.

// #region shapes
/** DeleteObjects takes at most this many keys in one request. */
export const DELETE_LIMIT = 1000;

const target = v.object({ Key: v.string(), VersionId: v.string() });
export type Target = v.InferOutput<typeof target>;

export const versionsPageSchema = v.object({
  Versions: v.optional(
    v.array(v.object({ ...target.entries, Size: v.optional(v.number(), 0) })),
    [],
  ),
  DeleteMarkers: v.optional(v.array(target), []),
  /** Present while the CLI has more to list than --max-items allowed. */
  NextToken: v.optional(v.string()),
});
export type VersionsPage = v.InferOutput<typeof versionsPageSchema>;

/** In quiet mode S3 reports only the keys it could not delete. */
export const deleteResultSchema = v.object({
  Errors: v.optional(
    v.array(
      v.object({
        Key: v.string(),
        VersionId: v.optional(v.string()),
        Code: v.string(),
        Message: v.optional(v.string(), ""),
      }),
    ),
    [],
  ),
});
export type DeleteResult = v.InferOutput<typeof deleteResultSchema>;
export type DeleteError = DeleteResult["Errors"][number];
// #endregion shapes

// #region plan
/** A delete marker is a version too: the bucket is not empty while one is left. */
export const targetsOf = (page: VersionsPage): Target[] =>
  [...page.Versions, ...page.DeleteMarkers].map(({ Key, VersionId }) => ({ Key, VersionId }));

export function batches(targets: readonly Target[], limit = DELETE_LIMIT): Target[][] {
  const result: Target[][] = [];
  for (let start = 0; start < targets.length; start += limit) {
    result.push(targets.slice(start, start + limit));
  }
  return result;
}

export const deleteDocument = (batch: readonly Target[]) => ({ Objects: batch, Quiet: true });

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** Why this bucket is not one to empty from a script, or undefined if it may be. */
export function refusal(bucket: string): string | undefined {
  if (!BUCKET_NAME.test(bucket)) {
    return `"${bucket}" is not a bucket name.`;
  }
  // Chapter 02: the state bucket is every stack's record, and is emptied by hand, last.
  if (bucket.startsWith("cdkd-state-") || bucket.startsWith("cdkd-assets-")) {
    return `${bucket} belongs to cdkd. Chapter 02 empties it by hand, after every stack is gone.`;
  }
  return undefined;
}
// #endregion plan

// #region loop
export type BucketIo = {
  list(startingToken?: string): Promise<VersionsPage>;
  remove(batch: Target[]): Promise<DeleteResult>;
};

export type Count = { versions: number; deleteMarkers: number; bytes: number };

export async function countBucket(io: BucketIo): Promise<Count> {
  const count: Count = { versions: 0, deleteMarkers: 0, bytes: 0 };
  let token: string | undefined;
  do {
    const page = await io.list(token);
    count.versions += page.Versions.length;
    count.deleteMarkers += page.DeleteMarkers.length;
    count.bytes += page.Versions.reduce((sum, version) => sum + version.Size, 0);
    token = page.NextToken;
  } while (token !== undefined);
  return count;
}

export type Emptied = { deleted: number; failed: DeleteError[]; rounds: number };

/**
 * Lists from the start, deletes what it saw, and lists again until nothing is listed. What was
 * deleted is gone from the next listing, so no position is carried between rounds and a run that
 * was cut short is resumed by running it again.
 */
export async function emptyBucket(io: BucketIo, maxRounds = 10_000): Promise<Emptied> {
  let deleted = 0;
  for (let rounds = 0; rounds < maxRounds; rounds += 1) {
    const targets = targetsOf(await io.list());
    if (targets.length === 0) {
      return { deleted, failed: [], rounds };
    }
    const failed: DeleteError[] = [];
    for (const batch of batches(targets)) {
      const { Errors } = await io.remove(batch);
      failed.push(...Errors);
      deleted += batch.length - Errors.length;
    }
    // The same keys would fail the same way: stop and show them.
    if (failed.length > 0) {
      return { deleted, failed, rounds: rounds + 1 };
    }
  }
  throw new Error(`The bucket still lists objects after ${maxRounds} rounds of deleting.`);
}
// #endregion loop
