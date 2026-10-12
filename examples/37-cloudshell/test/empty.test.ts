import { describe, expect, it } from "vite-plus/test";

import {
  batches,
  type BucketIo,
  countBucket,
  DELETE_LIMIT,
  emptyBucket,
  refusal,
  type Target,
  targetsOf,
} from "../src/empty.ts";

type Stored = Target & { marker: boolean; size: number };

/** A versioned bucket in memory. `locked` keys answer AccessDenied; `beforeRemove` lets a writer in. */
function bucketOf(
  stored: Stored[],
  options: { locked?: Set<string>; beforeRemove?: () => void; deaf?: boolean } = {},
) {
  const removals: number[] = [];
  const io: BucketIo = {
    list: async (startingToken) => {
      const start = Number(startingToken ?? "0");
      const page = stored.slice(start, start + DELETE_LIMIT);
      return {
        Versions: page
          .filter((item) => !item.marker)
          .map((item) => ({ Key: item.Key, VersionId: item.VersionId, Size: item.size })),
        DeleteMarkers: page
          .filter((item) => item.marker)
          .map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
        NextToken: stored.length > start + DELETE_LIMIT ? String(start + DELETE_LIMIT) : undefined,
      };
    },
    remove: async (batch) => {
      options.beforeRemove?.();
      removals.push(batch.length);
      const refused = batch.filter((item) => options.locked?.has(item.Key) === true);
      if (options.deaf !== true) {
        const gone = new Set(
          batch
            .filter((item) => !refused.includes(item))
            .map((item) => `${item.Key}\n${item.VersionId}`),
        );
        stored.splice(
          0,
          stored.length,
          ...stored.filter((item) => !gone.has(`${item.Key}\n${item.VersionId}`)),
        );
      }
      return {
        Errors: refused.map((item) => ({
          Key: item.Key,
          VersionId: item.VersionId,
          Code: "AccessDenied",
          Message: "Access Denied",
        })),
      };
    },
  };
  return { io, stored, removals };
}

const versions = (count: number, prefix = "k"): Stored[] =>
  Array.from({ length: count }, (_, index) => ({
    Key: `${prefix}${index}`,
    VersionId: "v1",
    marker: false,
    size: 10,
  }));

describe("batches for DeleteObjects", () => {
  it("hold every target exactly once, and never more than a thousand", () => {
    const targets = versions(2500);
    const result = batches(targets);
    expect(result.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect(result.flat()).toEqual(targets);
  });

  it("include delete markers: a bucket with one left is not empty", () => {
    const page = {
      Versions: [{ Key: "a", VersionId: "v1", Size: 1 }],
      DeleteMarkers: [{ Key: "a", VersionId: "m1" }],
    };
    expect(targetsOf(page)).toEqual([
      { Key: "a", VersionId: "v1" },
      { Key: "a", VersionId: "m1" },
    ]);
  });
});

describe("counting before deleting", () => {
  it("follows the token to the end and deletes nothing", async () => {
    const bucket = bucketOf([
      ...versions(2100),
      { Key: "gone", VersionId: "m1", marker: true, size: 0 },
    ]);
    expect(await countBucket(bucket.io)).toEqual({
      versions: 2100,
      deleteMarkers: 1,
      bytes: 21_000,
    });
    expect(bucket.removals).toEqual([]);
    expect(bucket.stored).toHaveLength(2101);
  });
});

describe("emptying a bucket", () => {
  it("removes every version and marker, a thousand at a time", async () => {
    const bucket = bucketOf([
      ...versions(2500),
      { Key: "gone", VersionId: "m1", marker: true, size: 0 },
    ]);
    expect(await emptyBucket(bucket.io)).toEqual({ deleted: 2501, failed: [], rounds: 3 });
    expect(bucket.stored).toEqual([]);
    expect(Math.max(...bucket.removals)).toBeLessThanOrEqual(DELETE_LIMIT);
  });

  it("stops at the first round with a refusal, and says which keys", async () => {
    const locked = new Set(["k1"]);
    const bucket = bucketOf(versions(3), { locked });
    const first = await emptyBucket(bucket.io);
    expect(first.deleted).toBe(2);
    expect(first.failed.map((error) => [error.Key, error.Code])).toEqual([["k1", "AccessDenied"]]);
    expect(first.rounds).toBe(1);

    // The same command again, once the cause is gone, finishes from what is left.
    locked.clear();
    expect(await emptyBucket(bucket.io)).toEqual({ deleted: 1, failed: [], rounds: 1 });
    expect(bucket.stored).toEqual([]);
  });

  it("catches an object written between the listing and the delete", async () => {
    let late = true;
    const stored = versions(2);
    const bucket = bucketOf(stored, {
      beforeRemove: () => {
        if (late) {
          stored.push({ Key: "late", VersionId: "v1", marker: false, size: 1 });
          late = false;
        }
      },
    });
    expect(await emptyBucket(bucket.io)).toEqual({ deleted: 3, failed: [], rounds: 2 });
    expect(bucket.stored).toEqual([]);
  });

  it("is a no-op on a bucket that is already empty", async () => {
    const bucket = bucketOf([]);
    expect(await emptyBucket(bucket.io)).toEqual({ deleted: 0, failed: [], rounds: 0 });
    expect(bucket.removals).toEqual([]);
  });

  it("gives up instead of looping when deletes report success and nothing goes", async () => {
    const bucket = bucketOf(versions(1), { deaf: true });
    await expect(emptyBucket(bucket.io, 3)).rejects.toThrow(/still lists objects after 3 rounds/);
  });
});

describe("buckets this will not empty", () => {
  it("refuses cdkd's own buckets", () => {
    expect(refusal("cdkd-state-111111111111")).toMatch(/belongs to cdkd/);
    expect(refusal("cdkd-assets-111111111111-ap-northeast-1")).toMatch(/belongs to cdkd/);
  });

  it("refuses what is not a bucket name, such as an option or a path", () => {
    expect(refusal("--yes")).toMatch(/not a bucket name/);
    expect(refusal("s3://aihuploads-uploads")).toMatch(/not a bucket name/);
  });

  it("lets a stack's own bucket through", () => {
    expect(refusal("aihuploads-uploads-example")).toBeUndefined();
  });
});
