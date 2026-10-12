import * as v from "valibot";

import { type Command, commandKeyOf, commandSchema, groupIdOf } from "./command.ts";

export const MAX_BATCH_ENTRIES = 10;
export const MAX_BATCH_BYTES = 1_048_576;

export type Entry = {
  MessageBody: string;
  MessageGroupId: string;
  MessageDeduplicationId: string;
  MessageAttributes: { change: { DataType: "String"; StringValue: string } };
};

// #region entry
export function toEntry(input: Command): Entry {
  // Checked on the way out too: a command the worker would park is better refused here.
  const command = v.parse(commandSchema, input);
  return {
    MessageBody: JSON.stringify(command),
    MessageGroupId: groupIdOf(command),
    // Sending the same command again within five minutes queues nothing.
    MessageDeduplicationId: commandKeyOf(command),
    // Readable without parsing the body, by a filter or a person looking at the queue.
    MessageAttributes: { change: { DataType: "String", StringValue: command.change.type } },
  };
}

const bytes = (text: string): number => new TextEncoder().encode(text).length;

/** The body and every part of every attribute count toward the 1 MiB of a message and of a batch. */
export const entryBytes = (entry: Entry): number =>
  bytes(entry.MessageBody) +
  Object.entries(entry.MessageAttributes).reduce(
    (sum, [name, value]) => sum + bytes(name) + bytes(value.DataType) + bytes(value.StringValue),
    0,
  );
// #endregion entry

// #region plan
/**
 * Batches of at most ten entries and 1 MiB, with at most one entry of a group
 * in each. A batch can fail in part. If two commands of one note shared a
 * batch, the second could be accepted while the first is not.
 */
export function planBatches<T>(items: T[], entryOf: (item: T) => Entry): T[][] {
  const batches: { items: T[]; bytes: number }[] = [];
  // The batch each group was last put in. A later command goes into a later batch.
  const last = new Map<string, number>();
  for (const item of items) {
    const entry = entryOf(item);
    const size = entryBytes(entry);
    let index = (last.get(entry.MessageGroupId) ?? -1) + 1;
    while (true) {
      const batch = batches[index];
      if (batch === undefined) {
        batches.push({ items: [item], bytes: size });
        break;
      }
      if (batch.items.length < MAX_BATCH_ENTRIES && batch.bytes + size <= MAX_BATCH_BYTES) {
        batch.items.push(item);
        batch.bytes += size;
        break;
      }
      index += 1;
    }
    last.set(entry.MessageGroupId, index);
  }
  return batches.map((batch) => batch.items);
}
// #endregion plan
