// vp run sfn:callback --verdict clean|infected    answers one waiting scan (changes AWS)
// vp run sfn:callback --fail                      reports that the scan itself failed
// vp run sfn:callback --heartbeat                 says "still scanning" and leaves the request in the queue
//   node scripts/callback.ts ...
//
// Plays the scanner by hand: takes one request from the queue and returns its
// task token to Step Functions. A real scanner is the worker of chapter 08.

import { parseArgs } from "node:util";

import {
  SendTaskFailureCommand,
  SendTaskHeartbeatCommand,
  SendTaskSuccessCommand,
  SFNClient,
} from "@aws-sdk/client-sfn";
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { scanRequestSchema, type ScanVerdict, scanVerdictSchema } from "../src/saga.ts";

const STACK = "AihStepFunctions";
const { values } = parseArgs({
  options: {
    verdict: { type: "string" },
    fail: { type: "boolean", default: false },
    heartbeat: { type: "boolean", default: false },
  },
});

try {
  const answer: ScanVerdict | "fail" | "heartbeat" = values.heartbeat
    ? "heartbeat"
    : values.fail
      ? "fail"
      : v.parse(scanVerdictSchema, { verdict: values.verdict });
  const { target } = await preflight({
    access: "mutate",
    action: "answer one scan request",
    stack: STACK,
  });
  const queueUrl = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "ScanRequestsQueueUrl",
  );
  const sqs = new SQSClient({ region: target.region });
  const sfn = new SFNClient({ region: target.region });
  const received = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 10 }),
  );
  const message = received.Messages?.[0];
  if (message?.Body === undefined || message.ReceiptHandle === undefined) {
    console.log("no scan request is waiting");
    process.exit(0);
  }
  // The body crossed a queue: checked before the token in it is trusted.
  const request = v.parse(scanRequestSchema, JSON.parse(message.Body));
  console.log(`request: ${request.saga}  s3://${request.bucket}/${request.key}`);

  if (answer === "heartbeat") {
    await sfn.send(new SendTaskHeartbeatCommand({ taskToken: request.taskToken }));
    console.log("heartbeat sent. The request returns to the queue after its visibility timeout.");
    process.exit(0);
  }
  try {
    if (answer === "fail") {
      await sfn.send(
        new SendTaskFailureCommand({
          taskToken: request.taskToken,
          error: "ScanFailed",
          cause: "reported by vp run sfn:callback --fail",
        }),
      );
    } else {
      await sfn.send(
        new SendTaskSuccessCommand({
          taskToken: request.taskToken,
          output: JSON.stringify(answer),
        }),
      );
    }
    console.log(answer === "fail" ? "reported a failed scan" : `answered ${answer.verdict}`);
  } finally {
    // Answered, or too late to answer (the task timed out and has a new token): done either way.
    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}
