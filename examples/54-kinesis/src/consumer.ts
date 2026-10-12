import type { KinesisStreamBatchResponse } from "aws-lambda";
import * as v from "valibot";

import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";

import type { HistoryStore } from "./history.ts";
import { decode, PoisonRecordError } from "./revision.ts";

// #region event
// What the event source mapping hands over. Only the fields this function reads.
const eventSchema = v.object({
  Records: v.array(
    v.object({
      eventID: v.string(),
      kinesis: v.object({
        partitionKey: v.string(),
        sequenceNumber: v.pipe(v.string(), v.regex(/^\d+$/)),
        // Base64, whatever the producer wrote.
        data: v.string(),
        // Seconds since the epoch, with milliseconds as a fraction.
        approximateArrivalTimestamp: v.number(),
      }),
    }),
  ),
});
// #endregion event

export type ConsumerDeps = {
  store: HistoryStore;
  log: Logger;
  /** `apply` for the consumer the stack deploys. `applyBlindly` only to show what goes wrong. */
  mode?: "guarded" | "blind";
};

// #region handler
// Records arrive in the shard's order. The function applies them in that
// order and stops at the first one it cannot apply, naming it: everything
// before it is done, and Lambda brings back that record and what follows.
export function createBatchHandler(deps: ConsumerDeps) {
  return async (input: unknown): Promise<KinesisStreamBatchResponse> => {
    const { Records } = v.parse(eventSchema, input);
    let applied = 0;
    let stale = 0;
    for (const { eventID, kinesis } of Records) {
      try {
        const revision = decode(kinesis.partitionKey, Buffer.from(kinesis.data, "base64"));
        if (deps.mode === "blind") {
          await deps.store.applyBlindly(revision);
          applied += 1;
        } else if ((await deps.store.apply(revision)) === "applied") {
          applied += 1;
        } else {
          stale += 1;
        }
      } catch (error) {
        deps.log({
          level: "error",
          message: error instanceof PoisonRecordError ? "poison record" : "record not applied",
          eventId: eventID,
          sequenceNumber: kinesis.sequenceNumber,
          reason: error instanceof Error ? error.message : String(error),
          applied,
          stale,
        });
        return { batchItemFailures: [{ itemIdentifier: kinesis.sequenceNumber }] };
      }
    }
    deps.log({ level: "info", message: "batch applied", records: Records.length, applied, stale });
    return { batchItemFailures: [] };
  };
}
// #endregion handler
