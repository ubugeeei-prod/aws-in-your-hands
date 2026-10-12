import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import * as v from "valibot";

import type { Logger } from "@aih/example-04-http-api/src/log.ts";

import type { Indexer, NoteChange } from "./indexer.ts";

// #region record
// A stream record carries items in DynamoDB's own notation: { "S": "text" }, { "N": "12" }.
const text = v.pipe(
  v.object({ S: v.string() }),
  v.transform((value) => value.S),
);
const wholeNumber = v.pipe(
  v.object({ N: v.string() }),
  v.transform((value) => Number(value.N)),
  v.number(),
  v.safeInteger(),
  v.minValue(1),
);
const image = v.object({ title: text, body: text, version: wholeNumber });

const recordSchema = v.object({
  eventName: v.picklist(["INSERT", "MODIFY", "REMOVE"]),
  dynamodb: v.object({
    SequenceNumber: v.pipe(v.string(), v.minLength(1)),
    Keys: v.object({ pk: text, sk: text }),
    NewImage: v.optional(image),
    OldImage: v.optional(image),
  }),
});

const OWNER = "OWNER#";
const NOTE = "NOTE#";

/** The change a record describes, or undefined for an item that is not a note. Throws on a note it cannot read. */
export function toChange(record: unknown): NoteChange | undefined {
  // Keys first: the table also holds items that are not notes (chapter 05's counter).
  const keys = v.parse(
    v.object({ dynamodb: v.object({ Keys: v.object({ pk: text, sk: text }) }) }),
    record,
  ).dynamodb.Keys;
  if (!keys.pk.startsWith(OWNER) || !keys.sk.startsWith(NOTE)) {
    return undefined;
  }
  const { eventName, dynamodb } = v.parse(recordSchema, record);
  if (eventName !== "REMOVE" && dynamodb.NewImage === undefined) {
    throw new Error(`${eventName} without a new image: is the stream NEW_AND_OLD_IMAGES?`);
  }
  return {
    owner: keys.pk.slice(OWNER.length),
    noteId: keys.sk.slice(NOTE.length),
    before: eventName === "INSERT" ? "none" : (dynamodb.OldImage ?? "unknown"),
    after: eventName === "REMOVE" ? undefined : dynamodb.NewImage,
  };
}
// #endregion record

// #region handler
/**
 * Records are applied in the order they arrive. At the first failure the rest of the
 * batch is left untouched and Lambda is told where to resume, so a later change to a
 * note is never applied before an earlier one.
 */
export function createStreamHandler(deps: { indexer: Indexer; log: Logger }) {
  return async (event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    for (const record of event.Records) {
      const sequenceNumber = record.dynamodb?.SequenceNumber;
      try {
        const change = toChange(record);
        if (change !== undefined) {
          await deps.indexer(change);
          deps.log({
            level: "info",
            message: "indexed",
            noteId: change.noteId,
            version: change.after?.version ?? null,
            sequenceNumber,
          });
        }
      } catch (error) {
        deps.log({
          level: "error",
          message: "indexing failed",
          sequenceNumber,
          error: error instanceof Error ? error.message : String(error),
        });
        if (sequenceNumber === undefined) {
          // Nothing to point at: fail the whole batch.
          throw error;
        }
        return { batchItemFailures: [{ itemIdentifier: sequenceNumber }] };
      }
    }
    return { batchItemFailures: [] };
  };
}
// #endregion handler
