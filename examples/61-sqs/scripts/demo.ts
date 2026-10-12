// vp run sqs:demo
//   node scripts/demo.ts
//
// The model queue, the deployed worker code, and two ledgers side by side:
// one that remembers which commands it applied, and one that trusts the queue.
// Nothing here touches AWS.

import type { Command } from "../src/command.ts";
import { FifoQueue } from "../src/fifo-queue.ts";
import { type Ledger, MemoryLedger } from "../src/ledger.ts";
import { ForgetfulLedger } from "../src/naive.ts";
import { deliverOnce } from "../src/poller.ts";
import { toEntry } from "../src/producer.ts";
import { QUEUE } from "../src/settings.ts";
import { createFifoBatchHandler } from "../src/worker.ts";

const VISIBILITY_MS = QUEUE.visibilityTimeoutSeconds * 1000;

async function run(name: string, ledger: Ledger): Promise<void> {
  let now = Date.parse("2026-10-13T00:00:00.000Z");
  let ids = 0;
  const clock = { now: () => new Date(now), newId: () => `m${(ids += 1)}` };
  const deadLetters = new FifoQueue({ ...clock, visibilityTimeoutMs: VISIBILITY_MS });
  const queue = new FifoQueue({
    ...clock,
    visibilityTimeoutMs: VISIBILITY_MS,
    deadLetter: { queue: deadLetters, maxReceiveCount: QUEUE.maxReceiveCount },
  });
  const send = (command: Command) => {
    const entry = toEntry(command);
    return queue.send({
      body: entry.MessageBody,
      groupId: entry.MessageGroupId,
      deduplicationId: entry.MessageDeduplicationId,
    });
  };

  // The first call to the ledger waits until `release` is called.
  let release = (): void => {};
  let gate: Promise<void> | undefined;
  const gated: Ledger = {
    async apply(command) {
      const waiting = gate;
      gate = undefined;
      await waiting;
      return ledger.apply(command);
    },
    get: (owner, noteId) => ledger.get(owner, noteId),
  };
  const worker = createFifoBatchHandler({
    ledger: gated,
    park: async (record) => {
      deadLetters.send({
        body: record.body,
        groupId: record.attributes.MessageGroupId,
        deduplicationId: record.messageId,
      });
    },
    log: () => {},
  });
  const command = (commandId: string, change: Command["change"]): Command => ({
    version: 1,
    commandId,
    owner: "alice",
    noteId: "n1",
    change,
  });

  console.log(`\n${name}`);
  const milk = command("c1", { type: "append", line: "milk" });
  send(command("c0", { type: "retitle", title: "Shopping" }));
  send(milk);
  console.log(`  the same command sent again at once: ${send(milk)}`);
  await deliverOnce(queue, worker, 10);

  now += 5 * 60 * 1000;
  console.log(`  and again five minutes later:        ${send(milk)}`);
  await deliverOnce(queue, worker, 10);

  // A worker that stops before it writes, for longer than the visibility timeout.
  send(command("c2", { type: "append", line: "eggs" }));
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = deliverOnce(queue, worker, 10);
  now += VISIBILITY_MS;
  const fast = await deliverOnce(queue, worker, 10);
  release();
  const late = await slow;
  console.log(
    `  second worker deleted ${fast.deleted}; first worker's delete came too late: ${late.late}`,
  );

  queue.send({ body: "not JSON", groupId: "alice/n1", deduplicationId: "x1" });
  send(command("c3", { type: "append", line: "bread" }));
  await deliverOnce(queue, worker, 10);

  const note = await ledger.get("alice", "n1");
  console.log(`  title: ${note?.title}`);
  console.log(`  lines: ${note?.lines.join(", ")}`);
  console.log(`  dead-letter queue: ${JSON.stringify(deadLetters.bodies())}`);
}

await run("a ledger that remembers the commands it applied", new MemoryLedger());
await run("a ledger that trusts the queue to deliver once", new ForgetfulLedger());
