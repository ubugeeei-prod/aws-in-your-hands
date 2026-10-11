// vp run async:queue             depth of both queues, and a look at the dead-letter queue (reads AWS)
// vp run async:queue --redrive   moves the dead-letter queue's messages back to the source queue (changes AWS)
//   node scripts/queue.ts [--redrive]
//
// Looking uses ReceiveMessage with a visibility timeout of 0: the messages
// stay where they are and stay visible, and only their receive count goes up.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";
import {
  GetQueueAttributesCommand,
  ListMessageMoveTasksCommand,
  ReceiveMessageCommand,
  SQSClient,
  StartMessageMoveTaskCommand,
} from "@aws-sdk/client-sqs";
import { parseNotification } from "../src/events.ts";

const STACK = "AihAsync";
const { values } = parseArgs({ options: { redrive: { type: "boolean", default: false } } });

/** What the worker would make of a message, without running it. */
function describe(body: string): string {
  try {
    const notification = parseNotification(body);
    return notification.kind === "test"
      ? "S3 test event"
      : notification.events.map((event) => `${event.type} ${event.key}`).join(", ");
  } catch (error) {
    return `not a message the worker can read: ${error instanceof Error ? error.message.split("\n")[0] : error}`;
  }
}

try {
  const { target } = await preflight({
    access: values.redrive ? "mutate" : "observe",
    action: values.redrive ? "move dead-letter messages back to the source queue" : "read queue depth",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const sqs = new SQSClient({ region: target.region });
  const deadLetterUrl = requireOutput(outputs, "DeadLetterQueueUrl");
  const deadLetterArn = requireOutput(outputs, "DeadLetterQueueArn");

  if (values.redrive) {
    // No destination: each message goes back to the queue it came from.
    const task = await sqs.send(new StartMessageMoveTaskCommand({ SourceArn: deadLetterArn }));
    console.log(`started: ${task.TaskHandle ?? "(no handle returned)"}`);
    console.log("The moved messages get new message IDs. Run `vp run async:queue` to follow the task.");
    process.exit(0);
  }

  for (const [name, url] of [
    ["source queue", requireOutput(outputs, "UploadEventsQueueUrl")],
    ["dead-letter queue", deadLetterUrl],
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
      MessageSystemAttributeNames: ["ApproximateReceiveCount", "SentTimestamp"],
    }),
  );
  for (const message of Messages) {
    const sent = Number(message.Attributes?.["SentTimestamp"]);
    console.log(
      `dead letter ${message.MessageId}: ${describe(message.Body ?? "")} ` +
        `(first sent ${Number.isFinite(sent) ? new Date(sent).toISOString() : "?"})`,
    );
  }
  if (Messages.length > 0) {
    console.log("Read the worker's log for these keys (`vp run async:logs`) before moving anything back.");
  }

  const { Results = [] } = await sqs.send(new ListMessageMoveTasksCommand({ SourceArn: deadLetterArn }));
  for (const task of Results) {
    console.log(`move task: ${task.Status}, moved ${task.ApproximateNumberOfMessagesMoved ?? 0}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
