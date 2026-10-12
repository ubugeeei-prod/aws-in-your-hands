import * as v from "valibot";

// #region failure-record
// What Lambda sends to the queue when it gives up on a batch: where the
// batch is, not what was in it. The shape is the documentation's example.
export const failureRecordSchema = v.object({
  requestContext: v.object({
    condition: v.string(),
    approximateInvokeCount: v.number(),
  }),
  KinesisBatchInfo: v.object({
    shardId: v.string(),
    startSequenceNumber: v.pipe(v.string(), v.regex(/^\d+$/)),
    endSequenceNumber: v.pipe(v.string(), v.regex(/^\d+$/)),
    approximateArrivalOfFirstRecord: v.pipe(v.string(), v.isoTimestamp()),
    approximateArrivalOfLastRecord: v.pipe(v.string(), v.isoTimestamp()),
    batchSize: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
    streamArn: v.string(),
  }),
});
export type FailureRecord = v.InferOutput<typeof failureRecordSchema>;

export function parseFailureRecord(body: string): FailureRecord {
  return v.parse(failureRecordSchema, JSON.parse(body));
}

/** Until when the batch can still be read back from the stream. */
export function readableUntil(record: FailureRecord, retentionHours: number): Date {
  const arrived = Date.parse(record.KinesisBatchInfo.approximateArrivalOfFirstRecord);
  return new Date(arrived + retentionHours * 60 * 60 * 1000);
}
// #endregion failure-record
