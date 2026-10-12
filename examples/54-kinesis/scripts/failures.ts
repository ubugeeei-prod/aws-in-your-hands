// vp run kinesis:failures               the batches Lambda gave up on, read back from the stream (reads AWS)
// vp run kinesis:failures -- --delete   also deletes the messages it showed (changes AWS)
//   node scripts/failures.ts [--delete]
//
// The failure queue holds where each batch is, not its records. This reads
// the records back from the stream while it still keeps them. Looking uses
// ReceiveMessage with a visibility timeout of 0: the messages stay.

import { parseArgs } from "node:util";

import { GetRecordsCommand, GetShardIteratorCommand, KinesisClient } from "@aws-sdk/client-kinesis";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { parseFailureRecord, readableUntil } from "../src/failure-record.ts";
import { decode } from "../src/revision.ts";
import { STREAM } from "../src/settings.ts";

const STACK = "AihKinesis";
const { values } = parseArgs({ options: { delete: { type: "boolean", default: false } } });

try {
  const { target } = await preflight({
    access: values.delete ? "mutate" : "observe",
    action: values.delete ? "read and delete the failure records" : "read the failure records",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const QueueUrl = requireOutput(outputs, "FailureQueueUrl");
  const sqs = new SQSClient({ region: target.region });
  const kinesis = new KinesisClient({ region: target.region });

  const { Messages = [] } = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl, MaxNumberOfMessages: 10, VisibilityTimeout: 0 }),
  );
  if (Messages.length === 0) {
    console.log("the failure queue is empty");
  }
  for (const message of Messages) {
    const failure = parseFailureRecord(message.Body ?? "");
    const batch = failure.KinesisBatchInfo;
    console.log(
      `${batch.shardId} ${batch.startSequenceNumber}..${batch.endSequenceNumber}: ${batch.batchSize} records, ` +
        `${failure.requestContext.condition} after ${failure.requestContext.approximateInvokeCount} invocations, ` +
        `readable until about ${readableUntil(failure, STREAM.retentionHours).toISOString()}`,
    );
    const { ShardIterator } = await kinesis.send(
      new GetShardIteratorCommand({
        StreamARN: batch.streamArn,
        ShardId: batch.shardId,
        ShardIteratorType: "AT_SEQUENCE_NUMBER",
        StartingSequenceNumber: batch.startSequenceNumber,
      }),
    );
    // One call: a batch is at most 100 records here, and GetRecords returns up to 10,000.
    const { Records = [] } = await kinesis.send(
      new GetRecordsCommand({ StreamARN: batch.streamArn, ShardIterator, Limit: batch.batchSize }),
    );
    for (const record of Records) {
      if (BigInt(record.SequenceNumber ?? "0") > BigInt(batch.endSequenceNumber)) {
        break;
      }
      try {
        const revision = decode(record.PartitionKey ?? "", record.Data ?? new Uint8Array());
        console.log(`  ${record.SequenceNumber}  ${revision.noteId}@${revision.version}`);
      } catch (error) {
        console.log(
          `  ${record.SequenceNumber}  ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (values.delete) {
      await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }));
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
