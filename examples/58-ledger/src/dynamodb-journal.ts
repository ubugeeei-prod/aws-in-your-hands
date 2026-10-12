import { DuplicateItemException, DynamoDBServiceException } from "@aws-sdk/client-dynamodb";
import { type DynamoDBDocumentClient, ExecuteStatementCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { DynamoDbTable } from "@aih/example-30-data-modeling/src/dynamodb-table.ts";

import { type Entry, toRow } from "./entry.ts";
import { tableNameSchema } from "./env.ts";
import { type Journal, tableJournal } from "./journal.ts";

// #region insert
const COLUMNS = ["pk", "sk", "seq", "at", "event", "prev", "hash"] as const;

// PartiQL's INSERT fails when the key exists and can do nothing else, so a role
// allowed only dynamodb:PartiQLInsert can add entries and cannot replace one.
// PutItem with a condition does the same today, but the role could leave the condition out.
export function insertStatement(tableName: string, entry: Entry) {
  const row = toRow(entry);
  return {
    // Values travel as parameters. Only the table name is part of the text.
    Statement: `INSERT INTO "${v.parse(tableNameSchema, tableName)}" VALUE {${COLUMNS.map((name) => `'${name}': ?`).join(", ")}}`,
    Parameters: COLUMNS.map((name) => row[name]),
  };
}
// #endregion insert

// The API reference names the error DuplicateItemException. DynamoDB Local 3.3.1
// answers with the name DuplicateItem, which the SDK cannot map to that class.
const isDuplicate = (error: unknown): boolean =>
  error instanceof DuplicateItemException ||
  (error instanceof DynamoDBServiceException && error.name === "DuplicateItem");

// #region journal
/** Reads through chapter 30's adapter (Query); writes through PartiQL's INSERT. */
export function dynamoDbJournal(
  client: Pick<DynamoDBDocumentClient, "send">,
  tableName: string,
): Journal {
  return {
    ...tableJournal(new DynamoDbTable(client, tableName)),
    async insert(entry) {
      try {
        await client.send(new ExecuteStatementCommand(insertStatement(tableName, entry)));
        return "ok";
      } catch (error) {
        if (isDuplicate(error)) {
          return "exists";
        }
        throw error;
      }
    },
  };
}
// #endregion journal
