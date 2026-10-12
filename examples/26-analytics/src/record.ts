import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

// #region schema
export const ROUTES = ["/health", "/notes", "/notes/:id", "other"] as const;
export const ACTIONS = [
  "note_created",
  "note_updated",
  "note_deleted",
  "update_conflicted",
] as const;

// Strict on purpose: a field nobody listed here (a title, a body, a header)
// fails the test instead of reaching the bucket, where it would stay for months.
export const requestRecordSchema = v.strictObject({
  // The version of this shape. A reader of old files needs to know which one it holds.
  v: v.literal(1),
  // v.uuid() checks the shape only. That is all a key for removing duplicates needs.
  event_id: v.pipe(v.string(), v.uuid()),
  // When the request was answered. Three decimals, so that text order is time order.
  at: v.pipe(utcTimestamp, v.regex(/\.\d{3}Z$/, "Must have milliseconds.")),
  request_id: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
  method: v.pipe(v.string(), v.regex(/^[A-Z]{3,7}$/)),
  // The pattern, never the path: a path holds a note's ID, and an unknown path holds anything.
  route: v.picklist(ROUTES),
  status: v.pipe(v.number(), v.integer(), v.minValue(100), v.maxValue(599)),
  duration_ms: v.pipe(v.number(), v.integer(), v.minValue(0)),
  // What the request did to a note, when it did something. null for reads and failures.
  action: v.nullable(v.picklist(ACTIONS)),
  note_id: v.nullable(v.pipe(v.string(), v.regex(/^[a-z0-9]{1,64}$/))),
});
export type RequestRecord = v.InferOutput<typeof requestRecordSchema>;
// #endregion schema

// #region columns
/** The same fields as Athena sees them. A test keeps the two lists equal, in this order. */
export const COLUMNS = [
  { name: "v", type: "int" },
  { name: "event_id", type: "string" },
  // Text, not timestamp: the JSON SerDe's timestamp type wants another spelling.
  { name: "at", type: "string" },
  { name: "request_id", type: "string" },
  { name: "method", type: "string" },
  { name: "route", type: "string" },
  { name: "status", type: "int" },
  { name: "duration_ms", type: "bigint" },
  { name: "action", type: "string" },
  { name: "note_id", type: "string" },
] as const satisfies readonly { name: keyof RequestRecord; type: "int" | "bigint" | "string" }[];
export type Column = (typeof COLUMNS)[number]["name"];
// #endregion columns

// #region line
/**
 * One record as Firehose receives it. Firehose joins records end to end with
 * nothing between them, and the JSON SerDe reads one object per line.
 */
export function toLine(record: RequestRecord): string {
  return `${JSON.stringify(v.parse(requestRecordSchema, record))}\n`;
}

export function parseLines(text: string): RequestRecord[] {
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => v.parse(requestRecordSchema, JSON.parse(line)));
}
// #endregion line
