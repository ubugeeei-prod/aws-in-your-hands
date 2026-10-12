import { SendMessageBatchCommand, SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";

import type { Command } from "./command.ts";
import { planBatches, toEntry } from "./producer.ts";
import type { FifoRecord } from "./worker.ts";

type Client = Pick<SQSClient, "send">;

// #region send
/**
 * Sends the commands in order. `held` are the ones not accepted: the entries
 * SQS reported as failed, and every later command of the same notes. Send
 * `held` again as it is; what was accepted is not queued twice within five minutes.
 */
export async function sendCommands(
  client: Client,
  queueUrl: string,
  commands: Command[],
): Promise<{ accepted: number; held: Command[] }> {
  const items = commands.map((command) => ({ command, entry: toEntry(command) }));
  const stopped = new Set<string>();
  const held: Command[] = [];
  let accepted = 0;
  for (const batch of planBatches(items, (item) => item.entry)) {
    const open = batch.filter((item) => !stopped.has(item.entry.MessageGroupId));
    held.push(
      ...batch.filter((item) => stopped.has(item.entry.MessageGroupId)).map((item) => item.command),
    );
    if (open.length === 0) {
      continue;
    }
    const result = await client.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: open.map((item, index) => ({ Id: String(index), ...item.entry })),
      }),
    );
    // HTTP 200 does not mean every entry was accepted.
    const failed = new Set((result.Failed ?? []).map((failure) => failure.Id));
    for (const [index, item] of open.entries()) {
      if (failed.has(String(index))) {
        stopped.add(item.entry.MessageGroupId);
        held.push(item.command);
      } else {
        accepted += 1;
      }
    }
  }
  return { accepted, held };
}
// #endregion send

// #region park
/** The worker's way to the dead-letter queue, for a message it will never be able to read. */
export function createParker(client: Client, deadLetterQueueUrl: string) {
  return async (record: FifoRecord, reason: string): Promise<void> => {
    await client.send(
      new SendMessageCommand({
        QueueUrl: deadLetterQueueUrl,
        MessageBody: record.body,
        MessageGroupId: record.attributes.MessageGroupId,
        // As SQS does when it moves a message there itself. A second attempt
        // to park the same delivery within five minutes queues nothing.
        MessageDeduplicationId: record.messageId,
        MessageAttributes: { parked: { DataType: "String", StringValue: reason } },
      }),
    );
  };
}
// #endregion park
