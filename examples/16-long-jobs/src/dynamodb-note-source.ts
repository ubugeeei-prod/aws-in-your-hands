import { type DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";

import type { ExportedNote, NotePage, NoteSource } from "./note-source.ts";

// Chapter 05's layout: pk "OWNER#<owner>", sk "NOTE#<id>".
const OWNER = "OWNER#";
const itemSchema = v.object({
  ...noteSchema.entries,
  pk: v.pipe(v.string(), v.startsWith(OWNER)),
  sk: v.string(),
});
const keySchema = v.object({ pk: v.string(), sk: v.string() });

function toNote(item: unknown): ExportedNote {
  const { pk, sk: _sk, ...note } = v.parse(itemSchema, item);
  return { ...note, owner: pk.slice(OWNER.length) };
}

export class DynamoDbNoteSource implements NoteSource {
  readonly #client: Pick<DynamoDBDocumentClient, "send">;
  readonly #tableName: string;

  constructor(client: Pick<DynamoDBDocumentClient, "send">, tableName: string) {
    this.#client = client;
    this.#tableName = tableName;
  }

  // #region scan
  async page(cursor: string | null, limit: number): Promise<NotePage> {
    const result = await this.#client.send(
      new ScanCommand({
        TableName: this.#tableName,
        // Counted before the filter: a page can come back with fewer notes, or none.
        Limit: limit,
        FilterExpression: "begins_with(sk, :note)",
        ExpressionAttributeValues: { ":note": "NOTE#" },
        // The cursor went through the workflow's state and back, so it is checked like any input.
        ...(cursor === null
          ? {}
          : {
              ExclusiveStartKey: v.parse(
                keySchema,
                JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
              ),
            }),
      }),
    );
    const last = result.LastEvaluatedKey;
    return {
      notes: (result.Items ?? []).map(toNote),
      // No LastEvaluatedKey is the only sign that the table has been read to the end.
      nextCursor:
        last === undefined
          ? null
          : Buffer.from(JSON.stringify(v.parse(keySchema, last)), "utf8").toString("base64url"),
    };
  }
  // #endregion scan
}
