import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import * as v from "valibot";

import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";

import { busEventSchema } from "./contract.ts";

// #region batch
/**
 * Fed from a queue the rule sends to, as chapter 08's worker is fed from
 * S3's. Each message body is one event as EventBridge delivered it.
 */
export function createCounterBatchHandler(deps: {
  count: (detail: unknown) => Promise<"counted" | "already_counted">;
  log: Logger;
}) {
  return async (batch: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of batch.Records) {
      try {
        const event = v.parse(busEventSchema, JSON.parse(record.body));
        const status = await deps.count(event.detail);
        deps.log({
          level: "info",
          message: "counter",
          status,
          messageId: record.messageId,
          replay: event["replay-name"] ?? null,
        });
      } catch (error) {
        deps.log({
          level: "error",
          message: "message failed",
          messageId: record.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Only this message goes back to the queue. An event counted before is not a failure.
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures };
  };
}
// #endregion batch
