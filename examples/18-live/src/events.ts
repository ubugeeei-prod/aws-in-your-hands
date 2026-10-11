import { z } from "zod";

// #region schema
const envelope = {
  id: z.string().min(1),
  source: z.literal("aws.ivs"),
  time: z.coerce.date(),
  resources: z.array(z.string()),
};

// event_name stays a string: a name this code has never seen should be
// recorded, not rejected.
const ivsEventSchema = z.discriminatedUnion("detail-type", [
  z.object({
    ...envelope,
    "detail-type": z.literal("IVS Stream State Change"),
    detail: z.object({
      event_name: z.string().min(1),
      stream_id: z.string().min(1),
      channel_name: z.string(),
      code: z.string().optional(),
      reason: z.string().optional(),
    }),
  }),
  z.object({
    ...envelope,
    "detail-type": z.literal("IVS Stream Health Change"),
    detail: z.object({ event_name: z.string().min(1), stream_id: z.string().min(1), channel_name: z.string() }),
  }),
  z.object({
    ...envelope,
    "detail-type": z.literal("IVS Limit Breach"),
    detail: z.object({
      limit_name: z.string().min(1),
      limit_value: z.number(),
      exceeded_by: z.number(),
      limit_unit: z.string(),
      stream_id: z.string().optional(),
      channel_name: z.string().optional(),
    }),
  }),
]);

export type IvsEvent = z.infer<typeof ivsEventSchema>;

export function parseIvsEvent(event: unknown): IvsEvent {
  return ivsEventSchema.parse(event);
}
// #endregion schema

// #region record
// One line per event in the function's log. `lagMs` is how late it arrived.
export const eventRecordSchema = z.object({
  kind: z.literal("ivs-event"),
  eventId: z.string(),
  type: z.string(),
  name: z.string(),
  streamId: z.string().nullable(),
  channelArn: z.string().nullable(),
  eventTime: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  lagMs: z.number(),
  detail: z.string().nullable(),
});

export type EventRecord = z.infer<typeof eventRecordSchema>;

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
      return { ...common, name: event.detail.event_name, streamId: event.detail.stream_id, detail: null };
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
