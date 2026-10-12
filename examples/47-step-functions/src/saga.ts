import * as v from "valibot";

import type { Retrier, State, StateMachine } from "./asl.ts";

// #region input
const segment = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));

/** What one import is given. The state machine does not check it; whoever starts it does. */
export const importInputSchema = v.strictObject({
  owner: segment,
  noteId: segment,
  title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120)),
  body: v.pipe(v.string(), v.maxLength(10_000)),
  /** The uploaded file, waiting under inbox/<owner>/. */
  upload: v.pipe(v.string(), v.regex(/^inbox\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,128}$/)),
});
export type ImportInput = v.InferOutput<typeof importInputSchema>;

/** One note, one name: starting the same import twice reaches the same execution. */
export const executionName = (input: ImportInput): string =>
  `import-${input.owner}-${input.noteId}`;
export const attachmentKey = (input: Pick<ImportInput, "owner" | "noteId">): string =>
  `attachments/${input.owner}/${input.noteId}`;
// #endregion input

// #region scan-message
/** The body of the message WaitForScan leaves in the queue. */
export const scanRequestSchema = v.strictObject({
  taskToken: v.pipe(v.string(), v.minLength(1), v.maxLength(2048)),
  saga: v.pipe(v.string(), v.minLength(1)),
  bucket: v.pipe(v.string(), v.minLength(1)),
  key: v.pipe(v.string(), v.minLength(1)),
});
export type ScanRequest = v.InferOutput<typeof scanRequestSchema>;

/** What the scanner sends back with SendTaskSuccess. */
export const scanVerdictSchema = v.strictObject({ verdict: v.picklist(["clean", "infected"]) });
export type ScanVerdict = v.InferOutput<typeof scanVerdictSchema>;
// #endregion scan-message

// #region conditions
// Each write says whose item it may touch. A step that runs twice passes its own
// condition again; a step that meets another import's item does not.
export const ABSENT_OR_MINE_WHILE_PENDING =
  "attribute_not_exists(pk) OR (#saga = :saga AND #phase = :pending)";
export const MINE = "#saga = :saga";
// #endregion conditions

export const SCAN_HEARTBEAT_SECONDS = 300;

// #region retry
// Throttling and a lost answer pass with time; a refusal does not.
const transient: Retrier = {
  ErrorEquals: ["States.Timeout", "States.TaskFailed"],
  IntervalSeconds: 2,
  MaxAttempts: 3,
  BackoffRate: 2,
  MaxDelaySeconds: 30,
  JitterStrategy: "FULL",
};
const never = (...errors: string[]): Retrier => ({ ErrorEquals: errors, MaxAttempts: 0 });
// #endregion retry

export type ImportResources = {
  tableName: string;
  bucketName: string;
  queueUrl: string;
  topicArn: string;
};
type States = Record<string, State>;

// #region shared
// The execution's name is the import's identity: in the item, in the conditions, in the notice.
const saga = { S: "{% $states.context.Execution.Name %}" };
const key = {
  pk: { S: "{% 'OWNER#' & $states.input.owner %}" },
  sk: { S: "{% 'NOTE#' & $states.input.noteId %}" },
};
const attachment = "{% 'attachments/' & $states.input.owner & '/' & $states.input.noteId %}";
/** Every step hands on the import it was given, so any state can find the note and the file. */
const same = "{% $states.input %}";
/** What a compensation is handed: the import, and why it is being undone. */
const failed = "{% $merge([$states.input, {'failure': $states.errorOutput}]) %}";
// #endregion shared

// #region steps
/** The two steps that can be undone. */
const steps = (resources: ImportResources): States => ({
  CreateNote: {
    Type: "Task",
    Resource: "arn:aws:states:::dynamodb:putItem",
    Arguments: {
      TableName: resources.tableName,
      Item: {
        ...key,
        id: { S: "{% $states.input.noteId %}" },
        title: { S: "{% $states.input.title %}" },
        body: { S: "{% $states.input.body %}" },
        version: { N: "1" },
        // The start time does not change between attempts, so a retry writes the same item.
        createdAt: { S: "{% $states.context.Execution.StartTime %}" },
        updatedAt: { S: "{% $states.context.Execution.StartTime %}" },
        saga,
        phase: { S: "pending" },
      },
      ConditionExpression: ABSENT_OR_MINE_WHILE_PENDING,
      ExpressionAttributeNames: { "#saga": "saga", "#phase": "phase" },
      ExpressionAttributeValues: { ":saga": saga, ":pending": { S: "pending" } },
    },
    Output: same,
    TimeoutSeconds: 30,
    Retry: [never("DynamoDB.ConditionalCheckFailedException"), transient],
    Catch: [
      // Another import owns this note ID. Nothing of ours was written.
      { ErrorEquals: ["DynamoDB.ConditionalCheckFailedException"], Next: "NoteIdTaken" },
      // Anything else may have been written: undo this step too, not only the ones before it.
      { ErrorEquals: ["States.ALL"], Output: failed, Next: "RemoveNote" },
    ],
    Next: "AttachFile",
  },
  AttachFile: {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:s3:copyObject",
    Arguments: {
      Bucket: resources.bucketName,
      CopySource: `{% '${resources.bucketName}/' & $states.input.upload %}`,
      Key: attachment,
    },
    Output: same,
    TimeoutSeconds: 60,
    Retry: [transient],
    Catch: [{ ErrorEquals: ["States.ALL"], Output: failed, Next: "RemoveAttachment" }],
    Next: "WaitForScan",
  },
});
// #endregion steps

// #region scan
/** Hands the file to a scanner outside the workflow, and waits for its answer. */
const scan = (resources: ImportResources): States => ({
  WaitForScan: {
    Type: "Task",
    Resource: "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
    Arguments: {
      QueueUrl: resources.queueUrl,
      MessageBody: {
        taskToken: "{% $states.context.Task.Token %}",
        saga: "{% $states.context.Execution.Name %}",
        bucket: resources.bucketName,
        key: attachment,
      },
    },
    // The result is what the scanner sent back with the token, not SQS's answer.
    Output: "{% $merge([$states.input, {'verdict': $states.result.verdict}]) %}",
    // The scanner must report in every five minutes, and be done within thirty.
    HeartbeatSeconds: SCAN_HEARTBEAT_SECONDS,
    TimeoutSeconds: 30 * 60,
    // A scanner that went quiet gets one more message, with a new token.
    Retry: [
      {
        ErrorEquals: ["States.Timeout", "States.HeartbeatTimeout"],
        IntervalSeconds: 5,
        MaxAttempts: 1,
      },
    ],
    Catch: [{ ErrorEquals: ["States.ALL"], Output: failed, Next: "RemoveAttachment" }],
    Next: "Verdict",
  },
  Verdict: {
    Type: "Choice",
    Choices: [{ Condition: "{% $states.input.verdict = 'clean' %}", Next: "Publish" }],
    // Not an error anyone threw, and still a reason to undo.
    Default: "RemoveAttachment",
  },
});
// #endregion scan

// #region commit
/** The step with no way back, and the one after it. */
const commit = (resources: ImportResources): States => ({
  Publish: {
    Type: "Task",
    Resource: "arn:aws:states:::dynamodb:updateItem",
    Arguments: {
      TableName: resources.tableName,
      Key: key,
      UpdateExpression: "SET #phase = :ready, #attachment = :attachment",
      ConditionExpression: MINE,
      ExpressionAttributeNames: { "#saga": "saga", "#phase": "phase", "#attachment": "attachment" },
      ExpressionAttributeValues: {
        ":saga": saga,
        ":ready": { S: "ready" },
        ":attachment": { S: attachment },
      },
    },
    Output: same,
    TimeoutSeconds: 30,
    Retry: [never("DynamoDB.ConditionalCheckFailedException"), transient],
    // No Catch. Once this may have happened, readers may have seen the note: there is
    // no undoing it, only doing it again. A failure ends the execution here, for a redrive.
    Next: "Notify",
  },
  Notify: {
    Type: "Task",
    Resource: "arn:aws:states:::sns:publish",
    Arguments: {
      TopicArn: resources.topicArn,
      Message: "{% 'Imported: ' & $states.input.title %}",
      MessageAttributes: {
        // A notice cannot be taken back, and may be sent twice. This is what a reader dedupes on.
        saga: { DataType: "String", StringValue: "{% $states.context.Execution.Name %}" },
      },
    },
    Output: "{% $merge([$states.input, {'notified': true}]) %}",
    TimeoutSeconds: 30,
    Retry: [transient],
    // The note is published. A notice that cannot be sent does not unpublish it.
    Catch: [
      {
        ErrorEquals: ["States.ALL"],
        Output: "{% $merge([$states.input, {'notified': false}]) %}",
        Next: "Imported",
      },
    ],
    Next: "Imported",
  },
  Imported: { Type: "Succeed" },
});
// #endregion commit

// #region compensations
/**
 * The undoing, in the reverse order of the steps. Neither state has a Catch:
 * one that fails ends the execution there, and a redrive resumes there.
 */
const compensations = (resources: ImportResources): States => ({
  RemoveAttachment: {
    Type: "Task",
    Resource: "arn:aws:states:::aws-sdk:s3:deleteObject",
    Arguments: { Bucket: resources.bucketName, Key: attachment },
    Output: same,
    TimeoutSeconds: 60,
    Retry: [transient],
    Next: "RemoveNote",
  },
  RemoveNote: {
    Type: "Task",
    Resource: "arn:aws:states:::dynamodb:deleteItem",
    Arguments: {
      TableName: resources.tableName,
      Key: key,
      ConditionExpression: ABSENT_OR_MINE_WHILE_PENDING,
      ExpressionAttributeNames: { "#saga": "saga", "#phase": "phase" },
      ExpressionAttributeValues: { ":saga": saga, ":pending": { S: "pending" } },
    },
    Output: same,
    TimeoutSeconds: 30,
    Retry: [never("DynamoDB.ConditionalCheckFailedException"), transient],
    Next: "RolledBack",
  },
  RolledBack: {
    Type: "Fail",
    Error: "ImportRolledBack",
    Cause: "A step failed or the scan refused the file. The note and its attachment are gone.",
  },
  NoteIdTaken: {
    Type: "Fail",
    Error: "NoteIdTaken",
    Cause: "Another import holds this note ID. This one wrote nothing.",
  },
});
// #endregion compensations

// #region definition
export function importNoteWorkflow(resources: ImportResources): StateMachine {
  return {
    Comment: "Imports a note with its attachment, or leaves nothing behind",
    QueryLanguage: "JSONata",
    StartAt: "CreateNote",
    // Longer than two scans at their limit. Past this, the import is stuck, not slow.
    TimeoutSeconds: 2 * 60 * 60,
    States: {
      ...steps(resources),
      ...scan(resources),
      ...commit(resources),
      ...compensations(resources),
    },
  };
}
// #endregion definition

/** Where an execution can stop with work half done: the step with no way back, and the two that undo. */
export const REDRIVABLE = ["Publish", "RemoveAttachment", "RemoveNote"] as const;
