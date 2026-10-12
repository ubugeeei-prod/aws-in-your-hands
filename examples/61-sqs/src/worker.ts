import * as v from "valibot";

import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";

import { commandKeyOf, parseCommand, UnreadableCommand } from "./command.ts";
import type { Ledger } from "./ledger.ts";

// #region batch
// What Lambda hands over from a FIFO queue. Only these fields are used.
export const batchSchema = v.object({
  Records: v.array(
    v.object({
      messageId: v.pipe(v.string(), v.minLength(1)),
      body: v.string(),
      attributes: v.object({ MessageGroupId: v.pipe(v.string(), v.minLength(1)) }),
    }),
  ),
});
export type FifoRecord = v.InferOutput<typeof batchSchema>["Records"][number];
export type BatchResponse = { batchItemFailures: { itemIdentifier: string }[] };

export type WorkerDeps = {
  ledger: Ledger;
  /** Sets a message aside in the dead-letter queue, in the worker's own name. */
  park: (record: FifoRecord, reason: UnreadableCommand["reason"]) => Promise<void>;
  log: Logger;
};

export function createFifoBatchHandler(deps: WorkerDeps) {
  return async (input: unknown): Promise<BatchResponse> => {
    const records = v.parse(batchSchema, input).Records;
    for (const [index, record] of records.entries()) {
      try {
        await handleRecord(deps, record);
      } catch (error) {
        deps.log({
          level: "error",
          message: "message failed",
          messageId: record.messageId,
          group: record.attributes.MessageGroupId,
          error: error instanceof Error ? error.message : String(error),
        });
        // Stop here. Reporting this one and everything after it keeps a later
        // command of the same note from being applied before this one.
        return {
          batchItemFailures: records
            .slice(index)
            .map((unprocessed) => ({ itemIdentifier: unprocessed.messageId })),
        };
      }
    }
    return { batchItemFailures: [] };
  };
}
// #endregion batch

// #region record
async function handleRecord(deps: WorkerDeps, record: FifoRecord): Promise<void> {
  let command;
  try {
    command = parseCommand(record.body);
  } catch (error) {
    if (!(error instanceof UnreadableCommand)) {
      throw error;
    }
    // Waiting will not make it readable, and while it waits its note's other
    // commands wait behind it. Out of the way now, where a person will see it.
    await deps.park(record, error.reason);
    deps.log({
      level: "error",
      message: "command parked",
      messageId: record.messageId,
      group: record.attributes.MessageGroupId,
      reason: error.message,
    });
    return;
  }
  const result = await deps.ledger.apply(command);
  deps.log({
    // A refusal is an answer, not a failure: delivering it again changes nothing.
    level: result === "refused" ? "warn" : "info",
    message: "command handled",
    messageId: record.messageId,
    command: commandKeyOf(command),
    result,
  });
}
// #endregion record
