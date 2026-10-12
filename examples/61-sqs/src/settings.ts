// The numbers the stack, the model in the tests, and the pages share.

export const QUEUE = {
  // Written out: a FIFO queue's name must end in .fifo, and the pinned cdkd
  // does not add the suffix to a name it generates.
  name: "aih-sqs-commands.fifo",
  deadLetterName: "aih-sqs-dead-letters.fifo",
  visibilityTimeoutSeconds: 60,
  retentionDays: 4,
  deadLetterRetentionDays: 14,
  maxReceiveCount: 5,
  receiveWaitSeconds: 20,
} as const;

export const CONSUMER = { timeoutSeconds: 10, batchSize: 10, maxConcurrency: 2 } as const;

// A command can wait 4 days in the queue and 14 in the dead-letter queue, and
// a redrive starts the 4 days again: 22 days. The marker outlives that.
export const MARKER_DAYS = 30;

// Two visibility timeouts: a command that failed twice. Five of them is when it leaves for the dead-letter queue.
export const ALARM = { oldestMessageSeconds: 120 } as const;
