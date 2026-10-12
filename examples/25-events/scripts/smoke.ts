// vp run events:smoke
//   node scripts/smoke.ts
//
// Writes a note into the deployed table with your credentials, the way the
// API's repository does, and waits for both consumers to hear of it:
// stream -> pipe -> shaping function -> bus -> rules -> timeline and counter.
// Then it updates and deletes the note and checks that both follow. Last, it
// puts a file that is not an image into the uploads bucket and waits for the
// notice in the rejection inbox: S3 -> chapter 08's worker -> the same pipe
// -> the rejections rule -> SNS -> SQS.

import { randomBytes } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { objectKey } from "@aih/example-07-uploads/api/src/keys.ts";
import { PENDING, STATE_TAG } from "@aih/example-07-uploads/api/src/object-store.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { DynamoDbCounterStore, DynamoDbTimelineStore } from "../src/dynamodb-projections.ts";
import { COUNTED_MARKER_DAYS } from "../src/routes.ts";

const STACK = "AihEvents";
const WAIT_MS = 120_000;

async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) {
      console.log(`ok   ${label} (after ${Math.round((Date.now() - started) / 1000)} s)`);
      return value;
    }
    if (Date.now() - started > WAIT_MS) {
      throw new Error(
        `${label}: not seen within ${WAIT_MS / 1000} s. Run \`vp run events:status\` and read the function logs.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

try {
  const { target } = await preflight({
    access: "mutate",
    action: "smoke test the event pipeline",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region }));
  const notes = new DynamoDbNoteRepository(documents, requireOutput(outputs, "TableName"));
  const projections = requireOutput(outputs, "ProjectionsTableName");
  const timeline = new DynamoDbTimelineStore(documents, projections);
  const counter = new DynamoDbCounterStore(
    documents,
    projections,
    COUNTED_MARKER_DAYS,
    () => new Date(),
  );

  // An owner no user has. Its projections stay behind; the note does not.
  const owner = `smoke-${randomBytes(4).toString("hex")}`;
  const id = `smoke${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();
  const entry = () => timeline.get(owner, id);

  const created = await notes.create(owner, {
    id,
    title: "events smoke",
    body: "",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
  if (created !== "created") {
    throw new Error(`could not write the note: ${created}`);
  }
  try {
    await waitFor("the timeline heard of the new note", entry, (value) => value?.rank === 1);
    await waitFor(
      "the counter counted it",
      () => counter.get(owner),
      (count) => count === 1,
    );

    const updated = await notes.update(owner, id, {
      title: "events smoke, edited",
      body: "",
      expectedVersion: 1,
      updatedAt: new Date().toISOString(),
    });
    if (updated.status !== "updated") {
      throw new Error(`could not update the note: ${updated.status}`);
    }
    await waitFor("the timeline follows the update", entry, (value) => value?.rank === 2);
  } finally {
    await notes.delete(owner, id);
  }
  await waitFor(
    "the timeline ends on the deletion",
    entry,
    (value) => value?.lastEvent === "NoteDeleted",
  );
  await waitFor(
    "the counter is back at zero",
    () => counter.get(owner),
    (count) => count === 0,
  );

  const sqs = new SQSClient({ region: target.region });
  const s3 = new S3Client({ region: target.region });
  const bucket = requireOutput(outputs, "UploadsBucketName");
  const inboxUrl = requireOutput(outputs, "RejectionInboxUrl");
  const attachmentId = `smoke${randomBytes(4).toString("hex")}`;
  const key = objectKey({ owner, noteId: id, attachmentId });
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: "<!doctype html><title>not an image</title>",
      ContentType: "image/png",
      // If this script stops halfway, chapter 07's lifecycle rule removes the object.
      Tagging: `${STATE_TAG}=${PENDING}`,
    }),
  );
  try {
    await waitFor(
      "a notice for the rejected upload reached the inbox",
      async () => {
        const { Messages = [] } = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: inboxUrl,
            MaxNumberOfMessages: 10,
            VisibilityTimeout: 5,
            WaitTimeSeconds: 5,
          }),
        );
        const notice = Messages.find((message) => message.Body?.includes(attachmentId));
        if (notice?.ReceiptHandle !== undefined) {
          console.log(`     ${notice.Body}`);
          await sqs.send(
            new DeleteMessageCommand({ QueueUrl: inboxUrl, ReceiptHandle: notice.ReceiptHandle }),
          );
        }
        return notice;
      },
      (notice) => notice !== undefined,
    );
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  const depth = await sqs.send(
    new GetQueueAttributesCommand({
      QueueUrl: requireOutput(outputs, "EventDeadLetterQueueUrl"),
      AttributeNames: ["ApproximateNumberOfMessages"],
    }),
  );
  console.log(
    `dead-letter queue: about ${depth.Attributes?.["ApproximateNumberOfMessages"] ?? "?"} messages`,
  );
  console.log(`checked at ${new Date().toISOString()}`);
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
