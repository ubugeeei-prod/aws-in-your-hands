import type { ObjectVersion, VersionedBucket } from "./versioned-bucket.ts";

// #region plan
export type RestoreStep =
  /** The key was deleted after the point: taking the marker away brings it back. */
  | { type: "remove_delete_marker"; key: string; versionId: string }
  /** The key was overwritten after the point: the old bytes are copied on top. */
  | { type: "copy_version"; key: string; versionId: string };

export type RestorePlan = {
  steps: RestoreStep[];
  /** Created after the point. Left alone: a restore that deletes is a second accident. */
  newerThanPoint: string[];
  unchanged: number;
};

// Newest first. S3 gives times to the second, so two versions of one key can
// tie; the one S3 calls the latest wins, and a tie between two old versions is
// left in listing order.
const newestFirst = (a: ObjectVersion, b: ObjectVersion): number =>
  b.lastModified.getTime() - a.lastModified.getTime() || Number(b.isLatest) - Number(a.isLatest);

/** Decides, key by key, what makes the current version equal to the one at `point`. Reads only. */
export function planObjectRestore(versions: Iterable<ObjectVersion>, point: Date): RestorePlan {
  const byKey = new Map<string, ObjectVersion[]>();
  for (const version of versions) {
    byKey.set(version.key, [...(byKey.get(version.key) ?? []), version]);
  }

  const plan: RestorePlan = { steps: [], newerThanPoint: [], unchanged: 0 };
  for (const [key, unordered] of [...byKey.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const history = unordered.toSorted(newestFirst);
    const latest = history[0];
    const after = history.filter((version) => version.lastModified.getTime() > point.getTime());
    const atPoint = history[after.length];

    if (atPoint === undefined || atPoint.deleteMarker) {
      // Not there at the point. If it is there now, it is newer data, not damage.
      if (latest !== undefined && !latest.deleteMarker) {
        plan.newerThanPoint.push(key);
      } else {
        plan.unchanged++;
      }
    } else if (
      after.length === 0 ||
      (latest !== undefined && !latest.deleteMarker && latest.eTag === atPoint.eTag)
    ) {
      // Untouched since the point, or already holding the same bytes (a copy made by an earlier run).
      plan.unchanged++;
    } else if (after.every((version) => version.deleteMarker)) {
      plan.steps.push(
        ...after.map((marker) => ({
          type: "remove_delete_marker" as const,
          key,
          versionId: marker.versionId,
        })),
      );
    } else {
      plan.steps.push({ type: "copy_version", key, versionId: atPoint.versionId });
    }
  }
  return plan;
}
// #endregion plan

// #region apply
/**
 * The plan is made from a fresh listing every time, so a run that stopped
 * halfway is finished by running it again: the steps already done are no
 * longer in the plan.
 */
export async function restoreObjects(
  bucket: VersionedBucket,
  options: { prefix: string; point: Date; dryRun: boolean },
): Promise<RestorePlan> {
  const versions: ObjectVersion[] = [];
  for await (const version of bucket.listVersions(options.prefix)) {
    versions.push(version);
  }
  const plan = planObjectRestore(versions, options.point);
  if (!options.dryRun) {
    for (const step of plan.steps) {
      if (step.type === "remove_delete_marker") {
        await bucket.removeVersion(step.key, step.versionId);
      } else {
        await bucket.copyVersion(step.key, step.versionId);
      }
    }
  }
  return plan;
}
// #endregion apply
