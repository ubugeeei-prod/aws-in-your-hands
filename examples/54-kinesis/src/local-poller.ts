import type { KinesisStreamBatchResponse, KinesisStreamEvent } from "aws-lambda";

import type { FailureRecord } from "./failure-record.ts";
import type { LocalStream, Position, StoredRecord } from "./local-stream.ts";

// A model of a Lambda event source mapping on a stream, for tests and the
// demo. It follows the Lambda documentation where the documentation speaks:
// one batch of a shard at a time, a failed batch tried again before anything
// later, the checkpoint moved to the first reported failure, a batch cut in
// two on an error, a batch given up on after its retries or its age. Two
// things the documentation leaves open are choices of this model, and are
// marked below. It is not Lambda.

// #region settings
export type MappingSettings = {
  batchSize: number;
  /** Tries after the first. -1: until the record leaves the stream. */
  maximumRetryAttempts: number;
  /** -1: no limit of its own. */
  maximumRecordAgeSeconds: number;
  bisectBatchOnFunctionError: boolean;
  reportBatchItemFailures: boolean;
};

/** What a mapping does when nothing but the stream and the function is given. */
export const LAMBDA_DEFAULTS: MappingSettings = {
  batchSize: 100,
  maximumRetryAttempts: -1,
  maximumRecordAgeSeconds: -1,
  bisectBatchOnFunctionError: false,
  reportBatchItemFailures: false,
};
// #endregion settings

export type Handler = (event: KinesisStreamEvent) => Promise<KinesisStreamBatchResponse | void>;
export type Invocation =
  | "idle"
  | "waiting-for-parent"
  | "succeeded"
  | "advanced"
  | "retrying"
  | "split"
  | "discarded";

type Batch = { records: StoredRecord[]; attempts: number };
type ShardState = { position: Position; work: Batch[]; finished: boolean };

const STREAM_ARN = "arn:aws:kinesis:ap-northeast-1:000000000000:stream/local";

export class LocalPoller {
  readonly #stream: LocalStream;
  readonly #handler: Handler;
  readonly #settings: MappingSettings;
  readonly #now: () => Date;
  readonly #start: Position;
  readonly #parentsFirst: boolean;
  readonly #shards = new Map<string, ShardState>();
  /** What would have gone to the on-failure destination. */
  readonly discarded: FailureRecord[] = [];
  /** The age of the last record of the newest event, as the IteratorAge metric measures it. */
  iteratorAgeMs = 0;
  invocations = 0;

  constructor(options: {
    stream: LocalStream;
    handler: Handler;
    settings: MappingSettings;
    now: () => Date;
    startingPosition?: Position;
    /** False reads a child shard without finishing its parent. Only to show what that does. */
    parentsFirst?: boolean;
  }) {
    this.#stream = options.stream;
    this.#handler = options.handler;
    this.#settings = options.settings;
    this.#now = options.now;
    this.#start = options.startingPosition ?? { type: "TRIM_HORIZON" };
    this.#parentsFirst = options.parentsFirst ?? true;
  }

  // #region poll
  /** One step for one shard: at most one invocation of the function. */
  async pollShard(shardId: string): Promise<Invocation> {
    const state = this.#state(shardId);
    const parent = this.#stream.shards().find((shard) => shard.shardId === shardId)?.parentShardId;
    // The Kinesis guide tells a reader to finish the parent first. The Lambda
    // pages read for this chapter do not say how a mapping orders them: a choice of this model.
    if (this.#parentsFirst && parent !== undefined && !this.#state(parent).finished) {
      return "waiting-for-parent";
    }
    if (state.work.length === 0) {
      const read = this.#stream.read(shardId, state.position, this.#settings.batchSize);
      const last = read.records.at(-1);
      if (read.next !== undefined) {
        state.position = read.next;
      } else if (last !== undefined) {
        state.position = { type: "AFTER_SEQUENCE_NUMBER", sequenceNumber: last.sequenceNumber };
      }
      if (last === undefined) {
        // The end of a closed shard: its children may be read now.
        state.finished = read.next === undefined;
        return "idle";
      }
      state.work.push({ records: read.records, attempts: 0 });
    }
    const batch = state.work[0];
    if (batch === undefined) {
      return "idle";
    }
    if (this.#tooOld(batch)) {
      state.work.shift();
      this.#discard(batch, "RecordAgeExceeded");
      return "discarded";
    }
    return this.#invoke(state, batch);
  }

  async #invoke(state: ShardState, batch: Batch): Promise<Invocation> {
    batch.attempts += 1;
    this.invocations += 1;
    const last = batch.records.at(-1);
    this.iteratorAgeMs =
      last === undefined ? 0 : this.#now().getTime() - last.approximateArrivalTimestamp.getTime();

    let failedAt = 0;
    try {
      const response = await this.#handler(toEvent(batch.records));
      // A response that names failures counts only if the mapping was told to listen.
      const reported = this.#settings.reportBatchItemFailures
        ? (response?.batchItemFailures ?? []).map((failure) => BigInt(failure.itemIdentifier))
        : [];
      if (reported.length === 0) {
        state.work.shift();
        return "succeeded";
      }
      // Several failures: the lowest sequence number is the checkpoint.
      const lowest = reported.reduce((a, b) => (a < b ? a : b));
      failedAt = batch.records.findIndex((record) => BigInt(record.sequenceNumber) === lowest);
      if (failedAt === -1) {
        failedAt = 0;
      }
    } catch {
      failedAt = 0;
    }

    if (failedAt > 0) {
      // Everything before the failure is done. The rest is a batch of its own.
      // Whether its retries start from zero is not documented: a choice of this model.
      state.work[0] = { records: batch.records.slice(failedAt), attempts: 0 };
      return "advanced";
    }
    if (this.#settings.bisectBatchOnFunctionError && batch.records.length > 1) {
      // Cutting in two does not use up a retry.
      const middle = Math.ceil(batch.records.length / 2);
      state.work.splice(
        0,
        1,
        { records: batch.records.slice(0, middle), attempts: 0 },
        { records: batch.records.slice(middle), attempts: 0 },
      );
      return "split";
    }
    const retries = this.#settings.maximumRetryAttempts;
    if (retries !== -1 && batch.attempts > retries) {
      state.work.shift();
      this.#discard(batch, "RetryAttemptsExhausted");
      return "discarded";
    }
    return "retrying";
  }
  // #endregion poll

  /** One step for every shard, parents before children. Returns whether anything was invoked or given up on. */
  async pollAll(): Promise<boolean> {
    let moved = false;
    for (const shard of this.#stream.shards()) {
      const outcome = await this.pollShard(shard.shardId);
      moved ||= outcome !== "idle" && outcome !== "waiting-for-parent";
    }
    return moved;
  }

  /** Polls until no shard has anything left, or the steps run out. Returns whether it got there. */
  async drain(maxSteps = 1000): Promise<boolean> {
    for (let step = 0; step < maxSteps; step += 1) {
      if (!(await this.pollAll())) {
        return true;
      }
    }
    return false;
  }

  #tooOld(batch: Batch): boolean {
    const limit = this.#settings.maximumRecordAgeSeconds;
    const first = batch.records[0];
    return (
      limit !== -1 &&
      first !== undefined &&
      this.#now().getTime() - first.approximateArrivalTimestamp.getTime() > limit * 1000
    );
  }

  #discard(batch: Batch, condition: string): void {
    const first = batch.records[0];
    const last = batch.records.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    this.discarded.push({
      requestContext: { condition, approximateInvokeCount: batch.attempts },
      KinesisBatchInfo: {
        shardId: first.shardId,
        startSequenceNumber: first.sequenceNumber,
        endSequenceNumber: last.sequenceNumber,
        approximateArrivalOfFirstRecord: first.approximateArrivalTimestamp.toISOString(),
        approximateArrivalOfLastRecord: last.approximateArrivalTimestamp.toISOString(),
        batchSize: batch.records.length,
        streamArn: STREAM_ARN,
      },
    });
  }

  #state(shardId: string): ShardState {
    let state = this.#shards.get(shardId);
    if (state === undefined) {
      state = { position: this.#start, work: [], finished: false };
      this.#shards.set(shardId, state);
    }
    return state;
  }
}

// #region to-event
/** The event a function receives, in the shape of the documentation's example. */
export function toEvent(records: StoredRecord[]): KinesisStreamEvent {
  return {
    Records: records.map((record) => ({
      kinesis: {
        kinesisSchemaVersion: "1.0",
        partitionKey: record.partitionKey,
        sequenceNumber: record.sequenceNumber,
        data: Buffer.from(record.data).toString("base64"),
        approximateArrivalTimestamp: record.approximateArrivalTimestamp.getTime() / 1000,
      },
      eventSource: "aws:kinesis",
      eventVersion: "1.0",
      eventID: `${record.shardId}:${record.sequenceNumber}`,
      eventName: "aws:kinesis:record",
      invokeIdentityArn: "arn:aws:iam::000000000000:role/local",
      awsRegion: "ap-northeast-1",
      eventSourceARN: STREAM_ARN,
    })),
  };
}
// #endregion to-event
