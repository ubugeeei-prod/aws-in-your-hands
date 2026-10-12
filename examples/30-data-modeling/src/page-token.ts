import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

import { idSchema, tagSchema } from "./model.ts";

export class InvalidPageTokenError extends Error {
  constructor() {
    super("The page token is not one this API issued for this list.");
    this.name = "InvalidPageTokenError";
  }
}

// #region token
// What a client holds between two pages: which list, and the last note it saw.
// No key names, no owner. The owner comes from the request, every time.
const positionSchema = v.variant("list", [
  v.strictObject({
    list: v.literal("recent"),
    // The index's sort key ends with the note ID, so both are needed to find the place again.
    updatedAt: utcTimestamp,
    noteId: idSchema,
  }),
  v.strictObject({ list: v.literal("tag"), tag: tagSchema, noteId: idSchema }),
]);
export type Position = v.InferOutput<typeof positionSchema>;

const MAX_TOKEN_LENGTH = 512;

export function encodePageToken(position: Position): string {
  return Buffer.from(JSON.stringify(position), "utf8").toString("base64url");
}

export function decodePageToken(token: string): Position {
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new InvalidPageTokenError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new InvalidPageTokenError();
  }
  const result = v.safeParse(positionSchema, parsed);
  if (!result.success) {
    throw new InvalidPageTokenError();
  }
  return result.output;
}
// #endregion token
