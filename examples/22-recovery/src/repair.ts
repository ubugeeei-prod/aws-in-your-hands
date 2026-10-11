import type { AttachmentRepository } from "@aih/example-07-uploads/api/src/attachment-repository.ts";
import { MAX_UPLOAD_BYTES } from "@aih/example-07-uploads/api/src/contract.ts";
import { judge } from "@aih/example-08-async/src/inspect.ts";
import type { InspectionRepository } from "@aih/example-08-async/src/inspection.ts";
import type { ObjectReader } from "@aih/example-08-async/src/object-reader.ts";
import type { Finding } from "./invariants.ts";
import type { ObjectVersion, VersionedBucket } from "./versioned-bucket.ts";

// #region sequencer
/**
 * The smallest sequencer greater than `sequencer`. A repair has no S3 event,
 * and so no sequencer of its own. This one outranks the stale record and
 * nothing else: for one key, every later event of S3 carries a greater or
 * equal value, so a late event still wins or is correctly called a duplicate.
 */
export function nextSequencer(sequencer: string): string {
  return (BigInt(`0x${sequencer}`) + 1n).toString(16).toUpperCase().padStart(sequencer.length, "0");
}
// #endregion sequencer

export type RepairDeps = {
  bucket: Pick<VersionedBucket, "listVersions" | "removeVersion">;
  attachments: Pick<AttachmentRepository, "delete">;
  inspections: Pick<InspectionRepository, "putIfNewer" | "deleteIfOlder">;
  reader: ObjectReader;
  now: () => Date;
};

export type Repaired = {
  finding: Finding["kind"];
  key: string;
  action: "object_undeleted" | "record_deleted" | "inspection_deleted" | "reinspected" | "nothing_to_do";
};

export type RepairReport = {
  repaired: Repaired[];
  /** Findings no rule here may decide. A person reads these. */
  left: Finding[];
};

// #region repair
/**
 * The table is the authority, and the bucket follows it: a record whose
 * object was deleted gets the object back if any version of it survives.
 * Every step states its own condition, so running this twice, or after a run
 * that stopped halfway, ends in the same state as running it once.
 */
export async function repair(
  deps: RepairDeps,
  findings: Finding[],
  options: { dryRun: boolean },
): Promise<RepairReport> {
  const report: RepairReport = { repaired: [], left: [] };
  // Lets a dry run answer as the real run would for the steps that follow an undelete.
  const undeleted = new Set<string>();

  for (const finding of findings) {
    switch (finding.kind) {
      case "attachment_without_object": {
        const markers = await deleteMarkersOnTop(deps.bucket, finding.key);
        if (markers !== undefined && markers.length === 0) {
          // The object is back already: an earlier run, or someone else, got here first.
          report.repaired.push({ finding: finding.kind, key: finding.key, action: "nothing_to_do" });
        } else if (markers !== undefined) {
          if (!options.dryRun) {
            for (const marker of markers) {
              await deps.bucket.removeVersion(finding.key, marker.versionId);
            }
          }
          undeleted.add(finding.key);
          report.repaired.push({ finding: finding.kind, key: finding.key, action: "object_undeleted" });
        } else {
          // No version is left to bring back. The record goes, as chapter 07's delete would have left it.
          if (!options.dryRun) {
            await deps.attachments.delete(finding.owner, finding.noteId, finding.attachmentId);
          }
          report.repaired.push({ finding: finding.kind, key: finding.key, action: "record_deleted" });
        }
        break;
      }
      case "inspection_without_object": {
        // An earlier step of this very run may have brought the object back.
        const back =
          undeleted.has(finding.key) ||
          (await deps.reader.readExact(finding.key, finding.recordedETag, 1)).status !== "gone";
        if (back) {
          report.repaired.push({ finding: finding.kind, key: finding.key, action: "nothing_to_do" });
          break;
        }
        if (!options.dryRun) {
          // Deletes this record and no newer one: an event that arrived meanwhile keeps its record.
          await deps.inspections.deleteIfOlder(
            finding.owner,
            finding.noteId,
            finding.attachmentId,
            nextSequencer(finding.sequencer),
          );
        }
        report.repaired.push({ finding: finding.kind, key: finding.key, action: "inspection_deleted" });
        break;
      }
      case "inspection_for_other_bytes": {
        // Chapter 08's steps 1 to 3, for the bytes that are under the key now.
        const object = await deps.reader.readExact(finding.key, finding.storedETag, MAX_UPLOAD_BYTES);
        if (object.status !== "found") {
          // Changed again since the snapshot. The next check sees what is there then.
          report.repaired.push({ finding: finding.kind, key: finding.key, action: "nothing_to_do" });
          break;
        }
        if (!options.dryRun) {
          const verdict = judge(object.bytes, object.contentType);
          await deps.inspections.putIfNewer(finding.owner, {
            noteId: finding.noteId,
            attachmentId: finding.attachmentId,
            sequencer: nextSequencer(finding.sequencer),
            eTag: finding.storedETag,
            size: object.size,
            declaredType: object.contentType,
            verdict: verdict.verdict,
            ...(verdict.verdict === "ok"
              ? { width: verdict.width, height: verdict.height }
              : { reason: verdict.reason }),
            inspectedAt: deps.now().toISOString(),
          });
        }
        report.repaired.push({ finding: finding.kind, key: finding.key, action: "reinspected" });
        break;
      }
      default:
        // Orphaned objects are the sweep's (chapter 07). The rest needs a decision, not a rule.
        report.left.push(finding);
    }
  }
  return report;
}

/** The delete markers above the newest version that still has bytes. Undefined when no such version exists. */
async function deleteMarkersOnTop(
  bucket: Pick<VersionedBucket, "listVersions">,
  key: string,
): Promise<ObjectVersion[] | undefined> {
  const history: ObjectVersion[] = [];
  for await (const version of bucket.listVersions(key)) {
    // The prefix also matches longer keys.
    if (version.key === key) {
      history.push(version);
    }
  }
  history.sort(
    (a, b) => b.lastModified.getTime() - a.lastModified.getTime() || Number(b.isLatest) - Number(a.isLatest),
  );
  const firstWithBytes = history.findIndex((version) => !version.deleteMarker);
  return firstWithBytes === -1 ? undefined : history.slice(0, firstWithBytes);
}
// #endregion repair
