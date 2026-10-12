// vp run async:smoke
//   node scripts/smoke.ts
//
// Puts a small image into the deployed bucket with your credentials, and
// waits for the worker's record: S3 -> SQS -> Lambda -> DynamoDB. Then it
// replaces the object, deletes it, and checks that the record follows. With
// AIH_ACCESS_TOKEN it also goes through the API, the way a browser does, and
// checks that sending a form again leaves no pending tag behind.

import { randomBytes } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  GetObjectTaggingCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetQueueAttributesCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { createNotesClient } from "@aih/example-06-auth/api/src/client.ts";
import { createAttachmentsClient, sendUpload } from "@aih/example-07-uploads/api/src/client.ts";
import { objectKey } from "@aih/example-07-uploads/api/src/keys.ts";
import { PENDING, STATE_TAG } from "@aih/example-07-uploads/api/src/object-store.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { DynamoDbInspectionRepository } from "../src/dynamodb-inspection-repository.ts";
import type { Inspection } from "../src/inspection.ts";

const STACK = "AihAsync";
const WAIT_MS = 90_000;
const token = process.env["AIH_ACCESS_TOKEN"];

// A 1x1 PNG, and bytes that are not an image at all.
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const notAnImage = Buffer.from("<!doctype html><title>not an image</title>");

/** S3 says its events usually arrive in seconds and can take a minute or longer. */
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
        `${label}: not seen within ${WAIT_MS / 1000} s. Check \`vp run async:queue\` and \`vp run async:logs\`.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

try {
  const { target } = await preflight({
    access: "mutate",
    action: "smoke test the upload pipeline",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const bucket = requireOutput(outputs, "UploadsBucketName");
  const s3 = new S3Client({ region: target.region });
  const inspections = new DynamoDbInspectionRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    requireOutput(outputs, "TableName"),
  );

  // An owner no user has, so nothing here can be mistaken for someone's image.
  const parts = {
    owner: `smoke-${randomBytes(4).toString("hex")}`,
    noteId: "note",
    attachmentId: "image",
  };
  const key = objectKey(parts);
  const record = () => inspections.get(parts.owner, parts.noteId, parts.attachmentId);
  const put = (body: Buffer) =>
    s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "image/png",
        // If this script stops halfway, the lifecycle rule removes the object.
        Tagging: `${STATE_TAG}=${PENDING}`,
      }),
    );

  try {
    await put(pixel);
    const first = await waitFor(
      "a record for the uploaded image",
      record,
      (value) => value?.verdict === "ok",
    );
    if (first?.width !== 1 || first.height !== 1) {
      throw new Error(`expected a 1x1 image, the record says ${first?.width}x${first?.height}`);
    }

    await put(notAnImage);
    const second = await waitFor(
      "the record follows the replacement",
      record,
      (value): value is Inspection => value?.verdict === "rejected",
    );
    if (second === undefined || second.sequencer <= first.sequencer) {
      throw new Error("the replacement's sequencer is not greater than the first one's");
    }
  } finally {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
  await waitFor("the record is dropped after the delete", record, (value) => value === undefined);

  if (token === undefined) {
    console.log("AIH_ACCESS_TOKEN is not set: the browser's path (a POST form) was NOT checked.");
  } else {
    const url = requireOutput(outputs, "ApiUrl");
    const notes = createNotesClient(url, () => token);
    const attachments = createAttachmentsClient(url, () => token);
    const { sub } = await notes.me();
    const note = await notes.create({ title: `async smoke ${new Date().toISOString()}`, body: "" });
    try {
      const png = () => new Blob([new Uint8Array(pixel)], { type: "image/png" });
      const permit = await attachments.requestUpload(note.id, { contentType: "image/png" });
      await sendUpload(permit, png());
      await attachments.finish(note.id, permit.attachmentId);
      await waitFor(
        "a record for an image uploaded with a form",
        () => inspections.get(sub, note.id, permit.attachmentId),
        (value) => value?.verdict === "ok",
      );

      // Chapter 07's gap: the same form again, after finishing.
      await sendUpload(permit, png());
      const formKey = objectKey({ owner: sub, noteId: note.id, attachmentId: permit.attachmentId });
      await waitFor(
        "the pending tag is taken off again after the form is sent twice",
        async () =>
          (await s3.send(new GetObjectTaggingCommand({ Bucket: bucket, Key: formKey }))).TagSet ??
          [],
        (tags) => tags.length === 0,
      );
    } finally {
      await notes.remove(note.id);
    }
  }

  const depth = await new SQSClient({ region: target.region }).send(
    new GetQueueAttributesCommand({
      QueueUrl: requireOutput(outputs, "DeadLetterQueueUrl"),
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
