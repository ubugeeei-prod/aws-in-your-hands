import * as v from "valibot";

export const EXPORT_PREFIX = "exports/";

// #region progress
const exportId = v.pipe(v.string(), v.regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/));

// Everything the workflow carries from one step to the next. Small on purpose:
// the notes themselves go to S3, never through the workflow's state.
export const progressSchema = v.object({
  exportId,
  /** Where the next page starts. null before the first page and after the last. */
  cursor: v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(2048))),
  /** The number the next part file gets, counting from 1. */
  nextPart: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(99_999)),
  notes: v.pipe(v.number(), v.integer(), v.minValue(0)),
  done: v.boolean(),
});
export type Progress = v.InferOutput<typeof progressSchema>;
// #endregion progress

// #region start
// What starts a run. The schedule sends the time the run was due, so two
// deliveries of the same firing name the same export.
const startSchema = v.object({
  exportId: v.pipe(v.string(), v.minLength(1), v.maxLength(80)),
});

/** The first step accepts either: what started the run, or what the previous step returned. */
export function toProgress(input: unknown): Progress {
  if (typeof input === "object" && input !== null && "nextPart" in input) {
    return v.parse(progressSchema, input);
  }
  const start = v.parse(startSchema, input);
  // "2026-10-12T03:00:00Z" becomes "2026-10-12T030000Z": no colons in an object key.
  return {
    exportId: v.parse(exportId, start.exportId.replaceAll(":", "")),
    cursor: null,
    nextPart: 1,
    notes: 0,
    done: false,
  };
}
// #endregion start

// #region keys
// The key is decided by the export and the part number alone, so a step that
// runs twice aims at the same object both times.
export const exportPrefix = (id: string): string => `${EXPORT_PREFIX}${id}/`;
export const partsPrefix = (id: string): string => `${exportPrefix(id)}parts/`;
export const partKey = (id: string, part: number): string =>
  `${partsPrefix(id)}${String(part).padStart(5, "0")}.ndjson`;
export const manifestKey = (id: string): string => `${exportPrefix(id)}manifest.json`;
// #endregion keys

export const manifestSchema = v.object({
  exportId,
  notes: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** Object keys, in order. Read these and nothing else under the prefix. */
  parts: v.array(v.string()),
});
export type Manifest = v.InferOutput<typeof manifestSchema>;

/** Step Functions matches a Catch on this name. */
export class ExportCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportCorrupt";
  }
}
