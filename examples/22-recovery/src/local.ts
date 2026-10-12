import { createHash } from "node:crypto";

import type { LogEntry } from "@aih/example-05-dynamodb/src/log.ts";
import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import {
  createAttachmentService,
  withAttachmentCleanup,
} from "@aih/example-07-uploads/api/src/attachments.ts";
import { objectKey } from "@aih/example-07-uploads/api/src/keys.ts";
import { sweep } from "@aih/example-07-uploads/api/src/sweep.ts";
import { handleEvent } from "@aih/example-08-async/src/worker.ts";

import { check, takeSnapshot } from "./invariants.ts";
import {
  MemoryTable,
  TableAttachmentRepository,
  TableInspectionRepository,
  TableNoteRepository,
} from "./memory-table.ts";
import { repair } from "./repair.ts";
import { MemoryVersionedBucket } from "./versioned-bucket.ts";

export const OWNER = "alice";
const MINUTE = 60_000;

// The first bytes of a PNG that declares 3x2 pixels: all chapter 08's inspection reads.
const pngHeader = (width: number, height: number): Uint8Array => {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
};
export const PNG = pngHeader(3, 2);
export const OTHER_PNG = new Uint8Array([...pngHeader(640, 480), 0]);
export const HTML = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");

export const eTagOf = (bytes: Uint8Array): string => createHash("md5").update(bytes).digest("hex");

/**
 * The real services of chapters 05, 07, and 08, on a table and a bucket that
 * can go back in time. Every step moves the clock one minute, so a restore
 * point can be placed between any two steps.
 */
export function createWorld() {
  let clock = Date.UTC(2026, 9, 12, 9, 0, 0);
  let counter = 0;
  let sequence = 0;
  const logs: LogEntry[] = [];
  const now = () => new Date(clock);
  const tick = (minutes = 1): Date => {
    const before = now();
    clock += minutes * MINUTE;
    return before;
  };

  const open = (table: MemoryTable, bucket: MemoryVersionedBucket) => {
    const noteRepository = new TableNoteRepository(table);
    const attachments = new TableAttachmentRepository(table);
    const inspections = new TableInspectionRepository(table);
    const log = (entry: LogEntry) => void logs.push(entry);
    const randomSuffix = () => String(++counter).padStart(4, "0");
    const plainNotes = createNoteService({ repository: noteRepository, now, randomSuffix });
    const attachmentService = createAttachmentService({
      notes: plainNotes,
      attachments,
      objects: bucket,
      now,
      randomSuffix,
      log,
    });
    const notes = withAttachmentCleanup(plainNotes, attachmentService, log);
    const worker = { reader: bucket, inspections, attachments, objects: bucket, now, log };

    /** The S3 event for what is under the key now, with a sequencer later than every earlier one. */
    const inspect = async (key: string, bytes: Uint8Array) => {
      const sequencer = (++sequence).toString(16).toUpperCase().padStart(32, "0");
      await handleEvent(worker, { type: "created", key, eTag: eTagOf(bytes), sequencer });
      return sequencer;
    };

    return {
      table,
      bucket,
      notes,
      noteRepository,
      attachments,
      inspections,
      attachmentService,
      inspect,
      async createNote(title: string) {
        const note = await notes.create(OWNER, { title, body: "" });
        tick();
        return note;
      },
      /** Permit, upload, finish, and the worker's inspection: one attached and inspected image. */
      async attach(noteId: string, bytes: Uint8Array = PNG) {
        const permitted = await attachmentService.requestUpload(OWNER, noteId, {
          contentType: "image/png",
        });
        if (permitted.status !== "permitted") {
          throw new Error(`upload not permitted: ${permitted.status}`);
        }
        const attachmentId = permitted.permit.attachmentId;
        const key = objectKey({ owner: OWNER, noteId, attachmentId });
        bucket.put(key, bytes, "image/png");
        const finished = await attachmentService.finish(OWNER, noteId, attachmentId);
        if (finished.status !== "attached") {
          throw new Error(`upload not attached: ${finished.status}`);
        }
        await inspect(key, bytes);
        tick();
        return { attachmentId, key };
      },
      /** Chapter 07's gap: the same form sent again replaces the bytes of an attached image. */
      async overwrite(key: string, bytes: Uint8Array) {
        bucket.put(key, bytes, "image/png");
        await inspect(key, bytes);
        tick();
      },
      /** The delete, its cascade to the attachments, and the delete events reaching the worker. */
      async deleteNote(noteId: string) {
        const images = await attachments.listByNote(OWNER, noteId);
        await notes.remove(OWNER, noteId);
        for (const image of images) {
          const sequencer = (++sequence).toString(16).toUpperCase().padStart(32, "0");
          const key = objectKey({ owner: OWNER, noteId, attachmentId: image.id });
          await handleEvent(worker, { type: "removed", key, sequencer });
        }
        tick();
      },
      report: async (graceMs = 0) =>
        check(await takeSnapshot(table, bucket), { now: now(), graceMs }),
      snapshot: () => takeSnapshot(table, bucket),
      repairDeps: () => ({ bucket, attachments, inspections, reader: bucket, now }),
      async repairAll(options: { dryRun: boolean } = { dryRun: false }) {
        const report = check(await takeSnapshot(table, bucket), { now: now(), graceMs: 0 });
        return repair(
          { bucket, attachments, inspections, reader: bucket, now },
          report.findings,
          options,
        );
      },
      sweep: (options: { dryRun: boolean }) =>
        sweep({ objects: bucket, attachments, notes: plainNotes, now }, { ...options, graceMs: 0 }),
    };
  };

  return { now, tick, logs, open, ...open(new MemoryTable(now), new MemoryVersionedBucket(now)) };
}

export type World = ReturnType<typeof createWorld>;
