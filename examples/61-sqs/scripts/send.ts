// vp run sqs:send                      three commands for one note, the second one twice (changes AWS)
// vp run sqs:send --note n2 --line hi  one append to a note of your choosing
//   node scripts/send.ts [--note <id>] [--line <text>] [--poison]
//
// --poison adds a message the worker cannot read, between two it can.

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import type { Command } from "../src/command.ts";
import { sendCommands } from "../src/sqs-sender.ts";

const STACK = "AihSqs";
const { values } = parseArgs({
  options: {
    note: { type: "string", default: "demo" },
    line: { type: "string" },
    poison: { type: "boolean", default: false },
  },
});

const command = (change: Command["change"]): Command => ({
  version: 1,
  commandId: randomUUID(),
  owner: "smoke",
  noteId: values.note,
  change,
});

try {
  const { target } = await preflight({
    access: "mutate",
    action: "send commands to the queue",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const queueUrl = requireOutput(outputs, "CommandsQueueUrl");
  const sqs = new SQSClient({ region: target.region });

  const first =
    values.line === undefined
      ? [command({ type: "retitle", title: "Shopping" }), command({ type: "append", line: "milk" })]
      : [command({ type: "append", line: values.line })];
  const sent = await sendCommands(sqs, queueUrl, first);
  console.log(`accepted ${sent.accepted}, held back ${sent.held.length}`);

  if (values.line === undefined) {
    // The same command once more: SQS answers as before and queues nothing.
    const again = await sendCommands(sqs, queueUrl, first.slice(1));
    console.log(
      `sent the append again: accepted ${again.accepted} (and deduplicated by the queue)`,
    );
    if (values.poison) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: "not a command",
          MessageGroupId: `smoke/${values.note}`,
          MessageDeduplicationId: randomUUID(),
        }),
      );
      console.log("sent a message the worker cannot read");
    }
    const last = await sendCommands(sqs, queueUrl, [command({ type: "append", line: "eggs" })]);
    console.log(`accepted ${last.accepted} more`);
  }
  console.log(
    `Run \`vp run sqs:status --note ${values.note}\` to see what the worker made of them.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
