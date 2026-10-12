// #region settings
// How the event source mapping reads the stream. The stack deploys these
// values and the local model of the mapping runs the tests with them.
export const CONSUMER = {
  batchSize: 100,
  /** Seconds Lambda may wait to fill a batch before it invokes. */
  maximumBatchingWindowSeconds: 1,
  /** Batches of one shard processed at a time. More than one keeps order per key, not per shard. */
  parallelizationFactor: 1,
  /** Tries after the first one. The default, -1, retries until the record leaves the stream. */
  maximumRetryAttempts: 3,
  /** Shorter than the stream's retention, so a record given up on can still be read back. */
  maximumRecordAgeSeconds: 6 * 60 * 60,
  bisectBatchOnFunctionError: true,
  reportBatchItemFailures: true,
} as const;

export const STREAM = { shards: 1, retentionHours: 24 } as const;

// What "behind" means here. Half an hour is far from the 24 hours after
// which a record is gone, and long enough that a slow minute does not ring.
export const ITERATOR_AGE_ALARM_MS = 30 * 60 * 1000;
// #endregion settings
