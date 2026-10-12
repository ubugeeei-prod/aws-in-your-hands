import type { DynamoDBBatchResponse } from "aws-lambda";
import * as v from "valibot";

import { createTable } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { type Change, project } from "./projector.ts";
import type { Table } from "./table.ts";

// #region record
// The stream is set to KEYS_ONLY, so a record carries the two keys and no item.
const recordSchema = v.object({
  eventID: v.pipe(v.string(), v.minLength(1)),
  eventName: v.picklist(["INSERT", "MODIFY", "REMOVE"]),
  dynamodb: v.object({
    SequenceNumber: v.pipe(v.string(), v.minLength(1)),
    Keys: v.object({ pk: v.object({ S: v.string() }), sk: v.object({ S: v.string() }) }),
  }),
});
const eventSchema = v.object({ Records: v.array(v.unknown()) });

export function toChange(record: unknown): Change | undefined {
  const parsed = v.safeParse(recordSchema, record);
  if (!parsed.success) {
    return undefined;
  }
  const { eventID, eventName, dynamodb } = parsed.output;
  return {
    eventId: eventID,
    eventName,
    sequenceNumber: dynamodb.SequenceNumber,
    pk: dynamodb.Keys.pk.S,
    sk: dynamodb.Keys.sk.S,
  };
}
// #endregion record

// #region handler
export function createHandler(deps: {
  table: Table;
  now: () => Date;
  log: (entry: Record<string, unknown>) => void;
}) {
  return async (event: unknown): Promise<DynamoDBBatchResponse> => {
    const { Records } = v.parse(eventSchema, event);
    const changes: Change[] = [];
    for (const record of Records) {
      const change = toChange(record);
      if (change === undefined) {
        // A record this code cannot read. Failing the whole batch sends it to
        // the retry limit and then to the dead-letter queue, where a person sees it.
        throw new Error("A stream record does not have the expected shape.");
      }
      changes.push(change);
    }
    const result = await project(deps.table, changes, deps.now());
    deps.log({ message: "projected", records: changes.length, ...result });
    return {
      // Lambda takes up the batch again from this record.
      batchItemFailures: result.failedAt === undefined ? [] : [{ itemIdentifier: result.failedAt }],
    };
  };
}
// #endregion handler

let cached: ReturnType<typeof createHandler> | undefined;

export const handler = (event: unknown): Promise<DynamoDBBatchResponse> => {
  cached ??= createHandler({
    table: createTable(parseEnv(process.env)),
    now: () => new Date(),
    log: (entry) => console.log(JSON.stringify(entry)),
  });
  return cached(event);
};
