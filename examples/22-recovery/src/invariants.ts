import type { Note } from "@aih/example-05-dynamodb/src/contract.ts";
import type { Attachment } from "@aih/example-07-uploads/api/src/contract.ts";
import {
  isKeySegment,
  KEY_PREFIX,
  objectKey,
  parseObjectKey,
} from "@aih/example-07-uploads/api/src/keys.ts";
import { SWEEP_GRACE_MS } from "@aih/example-07-uploads/api/src/sweep.ts";
import type { Inspection } from "@aih/example-08-async/src/inspection.ts";

import { attachmentKey, classify, inspectionKey, ownerKey, type TableReader } from "./items.ts";
import type { CurrentObject, VersionedBucket } from "./versioned-bucket.ts";

// #region snapshot
export type Snapshot = {
  notes: { owner: string; note: Note }[];
  attachments: { owner: string; attachment: Attachment }[];
  inspections: { owner: string; inspection: Inspection }[];
  unreadable: { pk: string; sk: string; reason: string }[];
  objects: CurrentObject[];
};

/** Two reads that are not one step: on a live system the two halves can be moments apart. */
export async function takeSnapshot(
  table: TableReader,
  bucket: Pick<VersionedBucket, "listCurrent">,
): Promise<Snapshot> {
  const snapshot: Snapshot = {
    notes: [],
    attachments: [],
    inspections: [],
    unreadable: [],
    objects: [],
  };
  for await (const item of table.scan()) {
    const found = classify(item);
    if (found.kind === "note") {
      snapshot.notes.push({ owner: found.owner, note: found.note });
    } else if (found.kind === "attachment") {
      snapshot.attachments.push({ owner: found.owner, attachment: found.attachment });
    } else if (found.kind === "inspection") {
      snapshot.inspections.push({ owner: found.owner, inspection: found.inspection });
    } else {
      snapshot.unreadable.push({ pk: found.pk, sk: found.sk, reason: found.reason });
    }
  }
  for await (const object of bucket.listCurrent(KEY_PREFIX)) {
    snapshot.objects.push(object);
  }
  return snapshot;
}
// #endregion snapshot

// #region findings
type Where = { owner: string; noteId: string; attachmentId: string; key: string };

export type Finding =
  /** Chapter 05: an item under a note key that does not read as a note. */
  | { kind: "unreadable_item"; pk: string; sk: string; reason: string }
  /** Chapter 05: version 1 means never updated, and an update never predates the creation. */
  | { kind: "note_version_mismatch"; owner: string; noteId: string }
  /** Chapter 07: a record must never outlive its object. */
  | ({ kind: "attachment_without_object" } & Where)
  /** Chapter 07: the record describes the bytes that were checked when the upload finished. */
  | ({ kind: "attachment_size_mismatch"; recorded: number; stored: number } & Where)
  /** Chapter 07: deleting a note deletes its attachments. Halfway is allowed; the sweep finishes it. */
  | ({ kind: "attachment_without_note" } & Where)
  /** Chapter 07: an object nobody points at is garbage, not damage. */
  | { kind: "object_without_record"; key: string }
  | { kind: "unknown_object"; key: string }
  /** Chapter 08: a verdict is about the bytes of one event. Other bytes under the key make it a verdict about nothing. */
  | ({
      kind: "inspection_for_other_bytes";
      sequencer: string;
      recordedETag: string;
      storedETag: string;
    } & Where)
  /** Chapter 08's two open paths end here: a record whose object is gone. */
  | ({ kind: "inspection_without_object"; sequencer: string; recordedETag: string } & Where);

/** `broken`: something the app relies on is false. `leftover`: garbage that cleanup is meant to find. */
export const SEVERITY = {
  unreadable_item: "broken",
  note_version_mismatch: "broken",
  attachment_without_object: "broken",
  attachment_size_mismatch: "broken",
  inspection_for_other_bytes: "broken",
  attachment_without_note: "leftover",
  object_without_record: "leftover",
  unknown_object: "leftover",
  inspection_without_object: "leftover",
} as const satisfies Record<Finding["kind"], "broken" | "leftover">;

export type Report = { findings: Finding[]; tooYoung: number };
// #endregion findings

// #region check
/**
 * Compares the two stores, and each with itself. Pure: it reads a snapshot
 * and writes nothing. `graceMs` is chapter 07's window for uploads that are
 * still being finished; pass 0 when writes are stopped.
 */
export function check(snapshot: Snapshot, options: { now: Date; graceMs?: number }): Report {
  const graceMs = options.graceMs ?? SWEEP_GRACE_MS;
  const findings: Finding[] = snapshot.unreadable.map((item) => ({
    kind: "unreadable_item",
    ...item,
  }));
  let tooYoung = 0;

  const id = (owner: string, ...rest: string[]): string => [owner, ...rest].join("/");
  const notes = new Set(snapshot.notes.map(({ owner, note }) => id(owner, note.id)));
  const objects = new Map(snapshot.objects.map((object) => [object.key, object]));
  const records = new Set<string>();

  for (const { owner, note } of snapshot.notes) {
    const neverUpdated = note.version === 1 && note.updatedAt !== note.createdAt;
    if (neverUpdated || note.updatedAt < note.createdAt) {
      findings.push({ kind: "note_version_mismatch", owner, noteId: note.id });
    }
  }

  // A key is built from these parts, so a part chapter 07 would refuse makes the record unreadable.
  const keyable = (...parts: string[]): boolean => parts.every(isKeySegment);

  for (const { owner, attachment } of snapshot.attachments) {
    if (!keyable(owner, attachment.noteId, attachment.id)) {
      const sk = attachmentKey(attachment.noteId, attachment.id);
      findings.push({
        kind: "unreadable_item",
        pk: ownerKey(owner),
        sk,
        reason: "cannot name an object",
      });
      continue;
    }
    const where = {
      owner,
      noteId: attachment.noteId,
      attachmentId: attachment.id,
      key: objectKey({ owner, noteId: attachment.noteId, attachmentId: attachment.id }),
    };
    records.add(where.key);
    const object = objects.get(where.key);
    if (object === undefined) {
      findings.push({ kind: "attachment_without_object", ...where });
    } else if (object.size !== attachment.size) {
      findings.push({
        kind: "attachment_size_mismatch",
        ...where,
        recorded: attachment.size,
        stored: object.size,
      });
    }
    if (!notes.has(id(owner, attachment.noteId))) {
      findings.push({ kind: "attachment_without_note", ...where });
    }
  }

  for (const { owner, inspection } of snapshot.inspections) {
    if (!keyable(owner, inspection.noteId, inspection.attachmentId)) {
      const sk = inspectionKey(inspection.noteId, inspection.attachmentId);
      findings.push({
        kind: "unreadable_item",
        pk: ownerKey(owner),
        sk,
        reason: "cannot name an object",
      });
      continue;
    }
    const where = {
      owner,
      noteId: inspection.noteId,
      attachmentId: inspection.attachmentId,
      key: objectKey({ owner, noteId: inspection.noteId, attachmentId: inspection.attachmentId }),
    };
    const object = objects.get(where.key);
    if (object === undefined) {
      findings.push({
        kind: "inspection_without_object",
        ...where,
        sequencer: inspection.sequencer,
        recordedETag: inspection.eTag,
      });
    } else if (object.eTag !== inspection.eTag) {
      findings.push({
        kind: "inspection_for_other_bytes",
        ...where,
        sequencer: inspection.sequencer,
        recordedETag: inspection.eTag,
        storedETag: object.eTag,
      });
    }
  }

  for (const object of snapshot.objects) {
    if (records.has(object.key)) {
      continue;
    }
    if (parseObjectKey(object.key) === undefined) {
      findings.push({ kind: "unknown_object", key: object.key });
    } else if (options.now.getTime() - object.lastModified.getTime() < graceMs) {
      // Possibly an upload between its POST and its finish. Not yet anyone's business.
      tooYoung++;
    } else {
      findings.push({ kind: "object_without_record", key: object.key });
    }
  }
  return { findings, tooYoung };
}

export const broken = (report: Report): Finding[] =>
  report.findings.filter((finding) => SEVERITY[finding.kind] === "broken");
// #endregion check
