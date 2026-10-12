// A model of an SQS FIFO queue, for the tests and the demo. It is not SQS.
// It keeps the rules the worker relies on, each as the documentation states it:
//
//   - a send needs a message group ID and a deduplication ID
//   - a deduplication ID accepted in the last five minutes: the send is
//     acknowledged and nothing is queued, even if the first message is long gone
//   - messages of a group are returned in the order they were accepted
//   - while a message of a group is received and neither deleted nor visible
//     again, a later receive returns nothing from that group
//   - one receive may return several messages of one group, and several groups
//   - a received message is hidden for the visibility timeout, then returns to its place
//   - every receive gives a new receipt handle; an old one deletes nothing
//   - the timeout of a received message can be changed, up to twelve hours after the receive
//   - a message received maxReceiveCount times moves to the dead-letter queue
//     at the next receive, with its message ID as its deduplication ID
//   - a redrive sends the dead-letter queue's messages as new messages, oldest first
//
// Left out: long polling, delay, retention, throughput quotas, content-based
// deduplication, deduplication per message group (high throughput mode), the
// receive request attempt ID, and permissions.

export const DEDUPLICATION_INTERVAL_MS = 5 * 60 * 1000;
export const MAX_VISIBILITY_MS = 12 * 60 * 60 * 1000;

type Stored = {
  messageId: string;
  body: string;
  groupId: string;
  deduplicationId: string;
  sequenceNumber: number;
  receiveCount: number;
  receivedAt: number;
  invisibleUntil: number;
};

export type Received = {
  messageId: string;
  receiptHandle: string;
  body: string;
  groupId: string;
  deduplicationId: string;
  sequenceNumber: string;
  receiveCount: number;
};

export type FifoQueueOptions = {
  now: () => Date;
  newId: () => string;
  visibilityTimeoutMs: number;
  deadLetter?: { queue: FifoQueue; maxReceiveCount: number };
};

export type SendInput = { body: string; groupId: string; deduplicationId: string };

const handleOf = (message: Stored): string => `${message.messageId}#${message.receiveCount}`;

// #region queue
export class FifoQueue {
  readonly #options: FifoQueueOptions;
  readonly #messages: Stored[] = [];
  readonly #accepted = new Map<string, number>();
  #sequence = 0;
  #deduplicated = 0;

  constructor(options: FifoQueueOptions) {
    this.#options = options;
  }

  /** SQS acknowledges both cases alike. The model says which one it was. */
  send(input: SendInput): "queued" | "deduplicated" {
    if (input.groupId === "" || input.deduplicationId === "") {
      throw new Error("a FIFO queue needs a message group ID and a deduplication ID");
    }
    const now = this.#options.now().getTime();
    const before = this.#accepted.get(input.deduplicationId);
    if (before !== undefined && now - before < DEDUPLICATION_INTERVAL_MS) {
      this.#deduplicated += 1;
      return "deduplicated";
    }
    this.#accepted.set(input.deduplicationId, now);
    this.#messages.push({
      ...input,
      messageId: this.#options.newId(),
      sequenceNumber: (this.#sequence += 1),
      receiveCount: 0,
      receivedAt: 0,
      invisibleUntil: 0,
    });
    return "queued";
  }

  receive(max: number): Received[] {
    const now = this.#options.now().getTime();
    this.#moveSpent(now);
    // Groups that an earlier receive still holds. What this receive takes does not count.
    const held = new Set(
      this.#messages.filter((message) => message.invisibleUntil > now).map((m) => m.groupId),
    );
    const batch: Received[] = [];
    for (const message of this.#messages) {
      if (batch.length >= Math.min(max, 10)) {
        break;
      }
      if (message.invisibleUntil > now || held.has(message.groupId)) {
        continue;
      }
      message.receiveCount += 1;
      message.receivedAt = now;
      message.invisibleUntil = now + this.#options.visibilityTimeoutMs;
      batch.push({
        messageId: message.messageId,
        receiptHandle: handleOf(message),
        body: message.body,
        groupId: message.groupId,
        deduplicationId: message.deduplicationId,
        sequenceNumber: String(message.sequenceNumber),
        receiveCount: message.receiveCount,
      });
    }
    return batch;
  }

  /** False when the handle is from an earlier receive: the message stays. */
  delete(receiptHandle: string): boolean {
    const index = this.#messages.findIndex((message) => handleOf(message) === receiptHandle);
    if (index === -1) {
      return false;
    }
    this.#messages.splice(index, 1);
    return true;
  }

  /** Counted from now. Zero gives the message back at once. */
  changeVisibility(receiptHandle: string, seconds: number): void {
    const message = this.#messages.find((candidate) => handleOf(candidate) === receiptHandle);
    const now = this.#options.now().getTime();
    if (message === undefined || message.invisibleUntil <= now) {
      throw new Error("the receipt handle is not the latest receive of a message in flight");
    }
    if (now + seconds * 1000 > message.receivedAt + MAX_VISIBILITY_MS) {
      throw new Error("the visibility timeout cannot reach past twelve hours after the receive");
    }
    message.invisibleUntil = now + seconds * 1000;
  }

  /** Every message leaves for `destination` as a new message. Returns how many were queued there. */
  redriveTo(destination: FifoQueue): number {
    let moved = 0;
    for (const message of this.#messages.splice(0)) {
      const result = destination.send({
        body: message.body,
        groupId: message.groupId,
        deduplicationId: message.deduplicationId,
      });
      moved += result === "queued" ? 1 : 0;
    }
    return moved;
  }

  #moveSpent(now: number): void {
    const deadLetter = this.#options.deadLetter;
    if (deadLetter === undefined) {
      return;
    }
    const spent = this.#messages.filter(
      (message) =>
        message.invisibleUntil <= now && message.receiveCount >= deadLetter.maxReceiveCount,
    );
    for (const message of spent) {
      this.#messages.splice(this.#messages.indexOf(message), 1);
      // The original deduplication ID is dropped, so that two unrelated
      // messages that shared one are both kept.
      deadLetter.queue.send({
        body: message.body,
        groupId: message.groupId,
        deduplicationId: message.messageId,
      });
    }
  }

  bodies(): string[] {
    return this.#messages.map((message) => message.body);
  }

  stats(): { visible: number; inFlight: number; deduplicated: number } {
    const now = this.#options.now().getTime();
    const inFlight = this.#messages.filter((message) => message.invisibleUntil > now).length;
    return {
      visible: this.#messages.length - inFlight,
      inFlight,
      deduplicated: this.#deduplicated,
    };
  }
}
// #endregion queue
