import { type KinesisClient, PutRecordsCommand } from "@aws-sdk/client-kinesis";

import type { Entry, PutOutcome, StreamWriter } from "./producer.ts";

// #region writer
export class KinesisWriter implements StreamWriter {
  readonly #client: Pick<KinesisClient, "send">;
  readonly #streamArn: string;

  constructor(client: Pick<KinesisClient, "send">, streamArn: string) {
    this.#client = client;
    this.#streamArn = streamArn;
  }

  async putRecords(entries: Entry[]): Promise<{ records: PutOutcome[] }> {
    const response = await this.#client.send(
      new PutRecordsCommand({
        StreamARN: this.#streamArn,
        Records: entries.map((entry) => ({ PartitionKey: entry.partitionKey, Data: entry.data })),
      }),
    );
    // The response has one element per entry, in the request's order.
    return {
      records: (response.Records ?? []).map((record) =>
        record.SequenceNumber !== undefined && record.ShardId !== undefined
          ? { shardId: record.ShardId, sequenceNumber: record.SequenceNumber }
          : { errorCode: record.ErrorCode ?? "unknown" },
      ),
    };
  }
}
// #endregion writer
