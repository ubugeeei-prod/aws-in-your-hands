import * as v from "valibot";

import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";
import type { AttachmentRepository } from "@aih/example-07-uploads/api/src/attachment-repository.ts";
import { MAX_UPLOAD_BYTES } from "@aih/example-07-uploads/api/src/contract.ts";
import { parseObjectKey } from "@aih/example-07-uploads/api/src/keys.ts";
import type { ObjectStore } from "@aih/example-07-uploads/api/src/object-store.ts";

import { type ObjectEvent, parseNotification } from "./events.ts";
import { judge } from "./inspect.ts";
import type { InspectionRepository } from "./inspection.ts";
import type { ObjectReader } from "./object-reader.ts";

export type WorkerDeps = {
  reader: ObjectReader;
  inspections: InspectionRepository;
  attachments: Pick<AttachmentRepository, "get">;
  objects: Pick<ObjectStore, "markAttached">;
  now: () => Date;
  log: Logger;
};

export type Outcome =
  | { status: "recorded"; verdict: "ok" | "rejected" }
  /** A record from this event, or a later one, was already there. */
  | { status: "duplicate" }
  | { status: "superseded" }
  | { status: "gone" }
  | { status: "forgotten" }
  | { status: "kept" }
  | { status: "ignored"; reason: "not_an_upload" | "unordered_removal" | "event_type" };

// #region handle-event
/** Safe to run any number of times, in any order, for the same event. */
export async function handleEvent(deps: WorkerDeps, event: ObjectEvent): Promise<Outcome> {
  const parts = parseObjectKey(event.key);
  if (parts === undefined) {
    return { status: "ignored", reason: "not_an_upload" };
  }
  if (event.type === "other") {
    return { status: "ignored", reason: "event_type" };
  }
  if (event.type === "removed") {
    // Without a sequencer there is no telling whether the object was created
    // again after this delete. Leaving a stale record is the safer mistake.
    if (event.sequencer === undefined) {
      return { status: "ignored", reason: "unordered_removal" };
    }
    const result = await deps.inspections.deleteIfOlder(
      parts.owner,
      parts.noteId,
      parts.attachmentId,
      event.sequencer,
    );
    return { status: result === "deleted" ? "forgotten" : "kept" };
  }

  // 1. Read the bytes this event is about. If they are gone or replaced,
  //    another event describes what is there now, and this one has nothing to do.
  const object = await deps.reader.readExact(event.key, event.eTag, MAX_UPLOAD_BYTES);
  if (object.status !== "found") {
    return { status: object.status === "gone" ? "gone" : "superseded" };
  }

  // 2. Decide. No side effect yet: stopping here loses nothing.
  const verdict = judge(object.bytes, object.contentType);

  // 3. Record, on the condition that nothing from this event or a later one is there.
  const written = await deps.inspections.putIfNewer(parts.owner, {
    noteId: parts.noteId,
    attachmentId: parts.attachmentId,
    sequencer: event.sequencer,
    eTag: event.eTag,
    size: object.size,
    declaredType: object.contentType,
    verdict: verdict.verdict,
    ...(verdict.verdict === "ok"
      ? { width: verdict.width, height: verdict.height }
      : { reason: verdict.reason }),
    inspectedAt: deps.now().toISOString(),
  });

  // 4. Chapter 07's gap: a form sent again after finishing puts the pending
  //    tag back on an attached image. This runs on a duplicate too. A worker
  //    that stopped between 3 and 4 left the record without this step, and
  //    "already recorded" must not be a reason to skip it.
  if ((await deps.attachments.get(parts.owner, parts.noteId, parts.attachmentId)) !== undefined) {
    await deps.objects.markAttached(event.key);
  }

  return written === "written"
    ? { status: "recorded", verdict: verdict.verdict }
    : { status: "duplicate" };
}
// #endregion handle-event

// #region batch
// Lambda hands over what it read from the queue. Only these two fields are used.
export const batchSchema = v.object({
  Records: v.array(v.object({ messageId: v.pipe(v.string(), v.minLength(1)), body: v.string() })),
});
export type Batch = v.InferOutput<typeof batchSchema>;
export type BatchResponse = { batchItemFailures: { itemIdentifier: string }[] };

export function createBatchHandler(deps: WorkerDeps) {
  return async (input: unknown): Promise<BatchResponse> => {
    const batchItemFailures: BatchResponse["batchItemFailures"] = [];
    for (const record of v.parse(batchSchema, input).Records) {
      try {
        const notification = parseNotification(record.body);
        if (notification.kind === "test") {
          deps.log({
            level: "info",
            message: "S3 test event acknowledged",
            messageId: record.messageId,
          });
          continue;
        }
        for (const event of notification.events) {
          const outcome = await handleEvent(deps, event);
          deps.log({
            level: "info",
            message: "event handled",
            messageId: record.messageId,
            key: event.key,
            ...outcome,
          });
        }
      } catch (error) {
        // One bad message must not send its nine neighbours back to the queue.
        // Naming it here leaves only this one to become visible again.
        deps.log({
          level: "error",
          message: "message failed",
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
// #endregion batch
