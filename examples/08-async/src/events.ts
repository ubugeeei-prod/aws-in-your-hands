import * as v from "valibot";

import { normalizeSequencer } from "./sequencer.ts";

// #region schema
// What S3 puts in the body of each SQS message. Only the fields the worker
// uses are listed; S3 adds fields in minor versions, and v.object drops the rest.
const recordSchema = v.object({
  eventName: v.string(),
  s3: v.object({
    object: v.object({
      key: v.pipe(v.string(), v.minLength(1)),
      eTag: v.optional(v.string()),
      // Present on create and delete events. Without it an event cannot be ordered.
      sequencer: v.optional(v.string()),
    }),
  }),
});

const notificationSchema = v.object({ Records: v.pipe(v.array(recordSchema), v.minLength(1)) });

// S3 sends this once when the notification is configured. It has no Records.
const testEventSchema = v.object({ Event: v.literal("s3:TestEvent") });
// #endregion schema

// #region parse
export type ObjectEvent =
  | { type: "created"; key: string; eTag: string; sequencer: string }
  | { type: "removed"; key: string; sequencer: string | undefined }
  | { type: "other"; key: string; eventName: string };

export type Notification = { kind: "test" } | { kind: "events"; events: ObjectEvent[] };

/** Throws on anything that is not a message S3 would send: such a message belongs in the DLQ. */
export function parseNotification(body: string): Notification {
  const json: unknown = JSON.parse(body);
  if (v.safeParse(testEventSchema, json).success) {
    return { kind: "test" };
  }
  return {
    kind: "events",
    events: v.parse(notificationSchema, json).Records.map((record): ObjectEvent => {
      // Keys arrive form-encoded: a space is "+", and other characters are percent-encoded.
      const key = decodeURIComponent(record.s3.object.key.replaceAll("+", " "));
      const { eTag, sequencer } = record.s3.object;
      if (record.eventName.startsWith("ObjectCreated:")) {
        if (eTag === undefined || sequencer === undefined) {
          throw new Error(`${record.eventName} for ${key} carries no eTag or no sequencer`);
        }
        return { type: "created", key, eTag, sequencer: normalizeSequencer(sequencer) };
      }
      if (
        record.eventName.startsWith("ObjectRemoved:") ||
        record.eventName.startsWith("LifecycleExpiration:")
      ) {
        return {
          type: "removed",
          key,
          sequencer: sequencer === undefined ? undefined : normalizeSequencer(sequencer),
        };
      }
      return { type: "other", key, eventName: record.eventName };
    }),
  };
}
// #endregion parse
