// vp run events:status                      the archive, the queues, and a look at the dead letters (reads AWS)
// vp run events:status -- --owner <sub>     also that owner's derived note count
//   node scripts/status.ts [--owner <sub>]
//
// Looking at the dead-letter queue uses ReceiveMessage with a visibility
// timeout of 0: the messages stay where they are, and only their receive
// count goes up.

import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DescribeArchiveCommand, EventBridgeClient } from "@aws-sdk/client-eventbridge";
import { GetQueueAttributesCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { describeDeadLetter } from "../src/dead-letter.ts";
import { DynamoDbCounterStore } from "../src/dynamodb-projections.ts";
import { COUNTED_MARKER_DAYS } from "../src/routes.ts";

const STACK = "AihEvents";
const { values } = parseArgs({ options: { owner: { type: "string" } } });

try {
  const { target } = await preflight({
    access: "observe",
    action: "read the archive and the queues",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const sqs = new SQSClient({ region: target.region });

  const archive = await new EventBridgeClient({ region: target.region }).send(
    new DescribeArchiveCommand({ ArchiveName: requireOutput(outputs, "ArchiveName") }),
  );
  // EventBridge reconciles these two numbers over 24 hours, by its own documentation.
  console.log(
    `archive ${archive.ArchiveName}: ${archive.State}, about ${archive.EventCount ?? "?"} events, ` +
      `${archive.SizeBytes ?? "?"} bytes, kept ${archive.RetentionDays} days`,
  );

  const deadLetterUrl = requireOutput(outputs, "EventDeadLetterQueueUrl");
  for (const [name, url] of [
    ["counter queue", requireOutput(outputs, "CounterQueueUrl")],
    ["rejection inbox", requireOutput(outputs, "RejectionInboxUrl")],
    ["dead-letter queue", deadLetterUrl],
  ] as const) {
    const { Attributes } = await sqs.send(
      new GetQueueAttributesCommand({
        QueueUrl: url,
        AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"],
      }),
    );
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
      MessageAttributeNames: ["All"],
    }),
  );
  for (const message of Messages) {
    const attributes = Object.fromEntries(
      Object.entries(message.MessageAttributes ?? {}).map(([name, value]) => [
        name,
        value.StringValue,
      ]),
    );
    console.log(
      `dead letter ${message.MessageId}: ${describeDeadLetter(attributes, message.Body ?? "")}`,
    );
  }

  if (values.owner !== undefined) {
    const counter = new DynamoDbCounterStore(
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
      requireOutput(outputs, "ProjectionsTableName"),
      COUNTED_MARKER_DAYS,
      () => new Date(),
    );
    console.log(`derived note count for ${values.owner}: ${await counter.get(values.owner)}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
