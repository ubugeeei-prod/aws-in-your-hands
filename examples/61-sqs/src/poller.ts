import type { FifoQueue } from "./fifo-queue.ts";
import type { BatchResponse } from "./worker.ts";

export type PolledRecord = {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: {
    ApproximateReceiveCount: string;
    MessageGroupId: string;
    MessageDeduplicationId: string;
    SequenceNumber: string;
  };
};

type Handler = (batch: { Records: PolledRecord[] }) => Promise<BatchResponse>;

// #region deliver
/**
 * One round of what Lambda's event source mapping does: receive a batch,
 * invoke the handler, delete what it did not report as failed. `late` counts
 * deletes that came after the receipt handle had been replaced by a newer receive.
 */
export async function deliverOnce(
  queue: FifoQueue,
  handler: Handler,
  batchSize: number,
): Promise<{ received: number; deleted: number; late: number }> {
  const batch = queue.receive(batchSize);
  if (batch.length === 0) {
    return { received: 0, deleted: 0, late: 0 };
  }
  const response = await handler({
    Records: batch.map((message) => ({
      messageId: message.messageId,
      receiptHandle: message.receiptHandle,
      body: message.body,
      attributes: {
        ApproximateReceiveCount: String(message.receiveCount),
        MessageGroupId: message.groupId,
        MessageDeduplicationId: message.deduplicationId,
        SequenceNumber: message.sequenceNumber,
      },
    })),
  });
  const failed = new Set(response.batchItemFailures.map((failure) => failure.itemIdentifier));
  let deleted = 0;
  let late = 0;
  for (const message of batch) {
    if (failed.has(message.messageId)) {
      continue;
    }
    if (queue.delete(message.receiptHandle)) {
      deleted += 1;
    } else {
      late += 1;
    }
  }
  return { received: batch.length, deleted, late };
}
// #endregion deliver
