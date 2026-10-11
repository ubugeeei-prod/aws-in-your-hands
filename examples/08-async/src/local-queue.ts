import type { BatchResponse } from "./worker.ts";

// A stand-in for an SQS standard queue with a dead-letter queue, small enough
// to read in one sitting. It keeps the three rules the worker has to survive:
// a received message is hidden, not removed; it comes back unless it is
// deleted in time; and after too many receives it is set aside. It says
// nothing about SQS's throughput, ordering, long polling, or permissions.

type Stored = { messageId: string; body: string; receiveCount: number; invisibleUntil: number };

export type Received = { messageId: string; receiptHandle: string; body: string; receiveCount: number };

export type LocalQueueOptions = {
  now: () => Date;
  visibilityTimeoutMs: number;
  maxReceiveCount: number;
  newId: () => string;
};

// #region queue
export class LocalQueue {
  readonly #options: LocalQueueOptions;
  readonly #messages: Stored[] = [];
  readonly #dead: Stored[] = [];

  constructor(options: LocalQueueOptions) {
    this.#options = options;
  }

  send(body: string): string {
    const messageId = this.#options.newId();
    this.#messages.push({ messageId, body, receiveCount: 0, invisibleUntil: 0 });
    return messageId;
  }

  receive(max: number): Received[] {
    const now = this.#options.now().getTime();
    const batch: Received[] = [];
    // Received this many times and never deleted: out of the worker's way,
    // kept for a person to look at.
    const spent = this.#messages.filter(
      (message) => message.invisibleUntil <= now && message.receiveCount >= this.#options.maxReceiveCount,
    );
    for (const message of spent) {
      this.#messages.splice(this.#messages.indexOf(message), 1);
      this.#dead.push(message);
    }
    for (const message of this.#messages) {
      if (batch.length >= max || message.invisibleUntil > now) {
        continue;
      }
      message.receiveCount += 1;
      message.invisibleUntil = now + this.#options.visibilityTimeoutMs;
      // The handle names this receive, not the message. A later receive gets another.
      batch.push({
        messageId: message.messageId,
        receiptHandle: `${message.messageId}#${message.receiveCount}`,
        body: message.body,
        receiveCount: message.receiveCount,
      });
    }
    return batch;
  }

  /** False when the handle is from an earlier receive: the message stays. */
  delete(receiptHandle: string): boolean {
    const index = this.#messages.findIndex(
      (message) => `${message.messageId}#${message.receiveCount}` === receiptHandle,
    );
    if (index === -1) {
      return false;
    }
    this.#messages.splice(index, 1);
    return true;
  }

  /** Back to the source queue, as new messages with new IDs, like an SQS redrive. */
  redrive(): number {
    const moved = this.#dead.splice(0);
    for (const message of moved) {
      this.send(message.body);
    }
    return moved.length;
  }

  dead(): { messageId: string; body: string; receiveCount: number }[] {
    return this.#dead.map(({ messageId, body, receiveCount }) => ({ messageId, body, receiveCount }));
  }

  stats(): { visible: number; inFlight: number; dead: number } {
    const now = this.#options.now().getTime();
    const inFlight = this.#messages.filter((message) => message.invisibleUntil > now).length;
    return { visible: this.#messages.length - inFlight, inFlight, dead: this.#dead.length };
  }
}
// #endregion queue

// #region deliver
type Handler = (batch: { Records: { messageId: string; body: string }[] }) => Promise<BatchResponse>;

/**
 * One round of what Lambda's event source mapping does: receive a batch,
 * invoke the handler, delete what it did not report as failed. If the handler
 * throws, nothing is deleted and the whole batch comes back later.
 */
export async function deliverOnce(queue: LocalQueue, handler: Handler, batchSize: number): Promise<number> {
  const batch = queue.receive(batchSize);
  if (batch.length === 0) {
    return 0;
  }
  const response = await handler({ Records: batch.map(({ messageId, body }) => ({ messageId, body })) });
  const failed = new Set(response.batchItemFailures.map((failure) => failure.itemIdentifier));
  for (const message of batch) {
    if (!failed.has(message.messageId)) {
      queue.delete(message.receiptHandle);
    }
  }
  return batch.length;
}
// #endregion deliver
