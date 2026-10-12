import * as v from "valibot";

// #region schema
const envelope = {
  id: v.pipe(v.string(), v.minLength(1)),
  source: v.literal("aws.ivs"),
  // EventBridge writes the time as text. The rest of the code wants a Date.
  time: v.pipe(
    v.string(),
    v.isoTimestamp(),
    v.transform((text) => new Date(text)),
  ),
  resources: v.array(v.string()),
};

// event_name stays a string: a name this code has never seen should be
// recorded, not rejected.
const ivsEventSchema = v.variant("detail-type", [
  v.object({
    ...envelope,
    "detail-type": v.literal("IVS Stream State Change"),
    detail: v.object({
      event_name: v.pipe(v.string(), v.minLength(1)),
      stream_id: v.pipe(v.string(), v.minLength(1)),
      channel_name: v.string(),
      code: v.optional(v.string()),
      reason: v.optional(v.string()),
    }),
  }),
  v.object({
    ...envelope,
    "detail-type": v.literal("IVS Stream Health Change"),
    detail: v.object({
      event_name: v.pipe(v.string(), v.minLength(1)),
      stream_id: v.pipe(v.string(), v.minLength(1)),
      channel_name: v.string(),
    }),
  }),
  v.object({
    ...envelope,
    "detail-type": v.literal("IVS Limit Breach"),
    detail: v.object({
      limit_name: v.pipe(v.string(), v.minLength(1)),
      limit_value: v.number(),
      exceeded_by: v.number(),
      limit_unit: v.string(),
      stream_id: v.optional(v.string()),
      channel_name: v.optional(v.string()),
    }),
  }),
]);

export type IvsEvent = v.InferOutput<typeof ivsEventSchema>;

export function parseIvsEvent(event: unknown): IvsEvent {
  return v.parse(ivsEventSchema, event);
}
// #endregion schema

// #region record
// One line per event in the function's log. `lagMs` is how late it arrived.
export const eventRecordSchema = v.object({
  kind: v.literal("ivs-event"),
  eventId: v.string(),
  type: v.string(),
  name: v.string(),
  streamId: v.nullable(v.string()),
  channelArn: v.nullable(v.string()),
  eventTime: v.pipe(v.string(), v.isoTimestamp()),
  receivedAt: v.pipe(v.string(), v.isoTimestamp()),
  lagMs: v.number(),
  detail: v.nullable(v.string()),
});

export type EventRecord = v.InferOutput<typeof eventRecordSchema>;

export function toRecord(event: IvsEvent, receivedAt: Date): EventRecord {
  const common = {
    kind: "ivs-event" as const,
    eventId: event.id,
    type: event["detail-type"],
    channelArn: event.resources[0] ?? null,
    eventTime: event.time.toISOString(),
    receivedAt: receivedAt.toISOString(),
    lagMs: receivedAt.getTime() - event.time.getTime(),
  };
  switch (event["detail-type"]) {
    case "IVS Stream State Change":
      return {
        ...common,
        name: event.detail.event_name,
        streamId: event.detail.stream_id,
        detail: event.detail.code ?? event.detail.reason ?? null,
      };
    case "IVS Stream Health Change":
      return {
        ...common,
        name: event.detail.event_name,
        streamId: event.detail.stream_id,
        detail: null,
      };
    case "IVS Limit Breach":
      return {
        ...common,
        name: event.detail.limit_name,
        streamId: event.detail.stream_id ?? null,
        detail: `${event.detail.limit_value} ${event.detail.limit_unit}, exceeded by ${event.detail.exceeded_by}`,
      };
  }
}
// #endregion record
