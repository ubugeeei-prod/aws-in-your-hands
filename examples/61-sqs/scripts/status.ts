// vp run sqs:status               both queues, the dead letters, and the note "demo" (reads AWS)
// vp run sqs:status --note n2     the same, for another note
// vp run sqs:status --redrive     moves the dead-letter queue's messages back to the source queue (changes AWS)
//   node scripts/status.ts [--note <id>] [--redrive]
//
// Looking at the dead-letter queue uses ReceiveMessage with a visibility
// timeout of 0: the messages stay visible, and their receive count goes up.

import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetQueueAttributesCommand,
  ListMessageMoveTasksCommand,
  ReceiveMessageCommand,
  SQSClient,
  StartMessageMoveTaskCommand,
} from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { parseCommand } from "../src/command.ts";
import { DynamoDbLedger } from "../src/dynamodb-ledger.ts";
import { MARKER_DAYS } from "../src/settings.ts";

const STACK = "AihSqs";
const { values } = parseArgs({
  options: {
    note: { type: "string", default: "demo" },
    redrive: { type: "boolean", default: false },
  },
});

/** What the worker would make of a message, without running it. */
function describe(body: string): string {
  try {
    const command = parseCommand(body);
    return `${command.change.type} for ${command.owner}/${command.noteId} (${command.commandId})`;
  } catch (error) {
    return `not a command the worker can read: ${error instanceof Error ? error.message : error}`;
  }
}

try {
  const { target } = await preflight({
    access: values.redrive ? "mutate" : "observe",
    action: values.redrive ? "move dead letters back to the source queue" : "read the queues",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const sqs = new SQSClient({ region: target.region });
  const deadLetterUrl = requireOutput(outputs, "DeadLetterQueueUrl");
  const deadLetterArn = requireOutput(outputs, "DeadLetterQueueArn");

  if (values.redrive) {
    // The destination is named. Without one SQS sends each message back to the queue it was
    // moved from, and a message the worker parked itself was never moved by SQS.
    const task = await sqs.send(
      new StartMessageMoveTaskCommand({
        SourceArn: deadLetterArn,
        DestinationArn: requireOutput(outputs, "CommandsQueueArn"),
      }),
    );
    console.log(`started: ${task.TaskHandle ?? "(no handle returned)"}`);
    console.log("The messages arrive as new messages, behind what the queue holds now.");
    console.log("Run `vp run sqs:status` to follow the task.");
    process.exit(0);
  }

  for (const [name, url] of [
    ["commands", requireOutput(outputs, "CommandsQueueUrl")],
    ["dead letters", deadLetterUrl],
  ] as const) {
    const { Attributes } = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
      }),
    );
    // Both numbers are approximate, by SQS's own naming.
    console.log(
      `${name}: about ${Attributes?.["ApproximateNumberOfMessages"] ?? "?"} waiting, ` +
        `about ${Attributes?.["ApproximateNumberOfMessagesNotVisible"] ?? "?"} being handled`,
    );
  }

  const { Messages = [] } = await sqs.send(
    new ReceiveMessageCommand({
      QueueUrl: deadLetterUrl,
      MaxNumberOfMessages: 10,
      VisibilityTimeout: 0,
      MessageSystemAttributeNames: ["MessageGroupId", "ApproximateReceiveCount"],
      MessageAttributeNames: ["parked"],
    }),
  );
  for (const message of Messages) {
    const parked = message.MessageAttributes?.["parked"]?.StringValue;
    console.log(
      `dead letter in ${message.Attributes?.["MessageGroupId"] ?? "?"}: ${describe(message.Body ?? "")}; ${
        parked === undefined ? "moved by the queue" : `parked by the worker (${parked})`
      }`,
    );
  }

  const { Results = [] } = await sqs.send(
    new ListMessageMoveTasksCommand({ SourceArn: deadLetterArn }),
  );
  for (const task of Results) {
    console.log(`move task: ${task.Status}, moved ${task.ApproximateNumberOfMessagesMoved ?? 0}`);
  }

  const ledger = new DynamoDbLedger(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    requireOutput(outputs, "EditsTableName"),
    MARKER_DAYS,
    () => new Date(),
  );
  const note = await ledger.get("smoke", values.note);
  console.log(
    note === undefined
      ? `note smoke/${values.note}: nothing applied yet`
      : `note smoke/${values.note}: title "${note.title}", lines ${JSON.stringify(note.lines)}, ${note.applied} commands applied`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
