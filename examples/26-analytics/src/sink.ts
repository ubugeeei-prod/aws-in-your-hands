import { type FirehoseClient, PutRecordCommand } from "@aws-sdk/client-firehose";

// #region sink
/** Where a record goes. Resolves once the other side has accepted the line. */
export type Sink = (line: string) => Promise<void>;
// #endregion sink

// #region firehose
// How long a request may wait for Firehose before its record is given up.
export const PUT_TIMEOUT_MS = 500;

export function firehoseSink(client: FirehoseClient, streamName: string): Sink {
  return async (line) => {
    await client.send(
      new PutRecordCommand({
        DeliveryStreamName: streamName,
        Record: { Data: new TextEncoder().encode(line) },
      }),
      // The SDK retries inside this bound. A retry after a lost answer writes the line twice.
      { abortSignal: AbortSignal.timeout(PUT_TIMEOUT_MS) },
    );
  };
}
// #endregion firehose
