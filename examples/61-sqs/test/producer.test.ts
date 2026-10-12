import type { SendMessageBatchCommand } from "@aws-sdk/client-sqs";
import { describe, expect, it } from "vite-plus/test";

import { parseCommand, UnreadableCommand } from "../src/command.ts";
import { entryBytes, MAX_BATCH_BYTES, planBatches, toEntry } from "../src/producer.ts";
import { sendCommands } from "../src/sqs-sender.ts";
import { append, retitle } from "./harness.ts";

describe("a command as a message", () => {
  it("is grouped by its note and named by itself", () => {
    const entry = toEntry(append("milk", { commandId: "c-1" }));
    expect(entry).toEqual({
      MessageBody: JSON.stringify({
        version: 1,
        commandId: "c-1",
        owner: "alice",
        noteId: "n1",
        change: { type: "append", line: "milk" },
      }),
      MessageGroupId: "alice/n1",
      MessageDeduplicationId: "alice/n1/c-1",
      MessageAttributes: { change: { DataType: "String", StringValue: "append" } },
    });
  });

  it("keeps the IDs within the 128 characters SQS allows", () => {
    const long = "x".repeat(40);
    const entry = toEntry(append("milk", { commandId: long, owner: long, noteId: long }));
    expect(entry.MessageDeduplicationId.length).toBeLessThanOrEqual(128);
    expect(() => toEntry(append("milk", { commandId: `${long}x` }))).toThrow();
  });

  it("refuses text SQS would refuse, before it is sent", () => {
    expect(() => toEntry(append("a￿b"))).toThrow("SQS does not accept");
    // A control character is fine: JSON.stringify writes it as an escape.
    expect(toEntry(append("a\u0000b")).MessageBody).toContain("a\\u0000b");
  });

  it("reads back what it wrote, and says why it cannot read anything else", () => {
    const command = retitle("  Shopping  ");
    expect(parseCommand(toEntry(command).MessageBody).change).toEqual({
      type: "retitle",
      title: "Shopping",
    });
    expect(() => parseCommand("not JSON")).toThrow(UnreadableCommand);
    expect(() => parseCommand(JSON.stringify({ ...command, version: 2 }))).toThrow("version");
    expect(() => parseCommand("[]")).toThrow("not_a_command");
  });
});

describe("planning batches", () => {
  const groups = (batches: ReturnType<typeof toEntry>[][]) =>
    batches.map((batch) => batch.map((entry) => entry.MessageGroupId));
  const plan = (entries: ReturnType<typeof toEntry>[]) => planBatches(entries, (entry) => entry);

  it("puts at most ten entries in a batch", () => {
    const entries = Array.from({ length: 23 }, (_, index) =>
      toEntry(append("x", { noteId: `n${index}` })),
    );
    expect(plan(entries).map((batch) => batch.length)).toEqual([10, 10, 3]);
  });

  it("never puts two commands of one note in the same batch, and keeps their order", () => {
    const entries = [
      toEntry(retitle("Draft")),
      toEntry(retitle("Final")),
      toEntry(append("milk", { noteId: "n2" })),
      toEntry(append("eggs")),
    ];
    const batches = plan(entries);
    expect(groups(batches)).toEqual([["alice/n1", "alice/n2"], ["alice/n1"], ["alice/n1"]]);
    expect(batches.flat().filter((entry) => entry.MessageGroupId === "alice/n1")).toEqual([
      entries[0],
      entries[1],
      entries[3],
    ]);
  });

  it("keeps a batch within 1 MiB, attributes included", () => {
    const big = { ...toEntry(append("x")), MessageBody: "x".repeat(400_000) };
    const entries = ["n1", "n2", "n3"].map((noteId) => ({
      ...big,
      MessageGroupId: `alice/${noteId}`,
    }));
    expect(entryBytes(big)).toBe(400_000 + "change".length + "String".length + "append".length);
    const batches = plan(entries);
    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
    for (const batch of batches) {
      expect(batch.reduce((sum, entry) => sum + entryBytes(entry), 0)).toBeLessThanOrEqual(
        MAX_BATCH_BYTES,
      );
    }
  });
});

describe("sending with the SQS client", () => {
  function client(failIds: (call: number) => string[]) {
    const sent: SendMessageBatchCommand[] = [];
    return {
      sent,
      send: async (command: SendMessageBatchCommand) => {
        sent.push(command);
        return {
          Failed: failIds(sent.length).map((Id) => ({ Id, Code: "x", SenderFault: false })),
        };
      },
    };
  }

  it("sends each batch with entry IDs of its own", async () => {
    const fake = client(() => []);
    const commands = [append("milk", { commandId: "c-1" }), append("eggs", { commandId: "c-2" })];
    expect(await sendCommands(fake as never, "https://queue.test/q.fifo", commands)).toEqual({
      accepted: 2,
      held: [],
    });
    expect(fake.sent.map((command) => command.input)).toEqual([
      { QueueUrl: "https://queue.test/q.fifo", Entries: [{ Id: "0", ...toEntry(commands[0]!) }] },
      { QueueUrl: "https://queue.test/q.fifo", Entries: [{ Id: "0", ...toEntry(commands[1]!) }] },
    ]);
  });

  it("holds back a note's later commands when an earlier one was not accepted", async () => {
    // The first batch reports its first entry as failed, under HTTP 200.
    const fake = client((call) => (call === 1 ? ["0"] : []));
    const commands = [
      retitle("Draft"),
      append("milk", { noteId: "n2" }),
      retitle("Final"),
      append("eggs", { noteId: "n2" }),
    ];
    const result = await sendCommands(fake as never, "https://queue.test/q.fifo", commands);

    expect(result).toEqual({ accepted: 2, held: [commands[0], commands[2]] });
    expect(fake.sent[1]?.input.Entries?.map((entry) => entry.MessageGroupId)).toEqual(["alice/n2"]);
  });
});
