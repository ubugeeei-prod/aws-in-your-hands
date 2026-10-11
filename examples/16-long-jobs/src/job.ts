import { z } from "zod";

export const EXPORT_PREFIX = "exports/";

// #region progress
const exportId = z.string().regex(/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/);

// Everything the workflow carries from one step to the next. Small on purpose:
// the notes themselves go to S3, never through the workflow's state.
export const progressSchema = z.object({
  exportId,
  /** Where the next page starts. null before the first page and after the last. */
  cursor: z.string().min(1).max(2048).nullable(),
  /** The number the next part file gets, counting from 1. */
  nextPart: z.number().int().min(1).max(99_999),
  notes: z.number().int().min(0),
  done: z.boolean(),
});
export type Progress = z.infer<typeof progressSchema>;
// #endregion progress

// #region start
// What starts a run. The schedule sends the time the run was due, so two
// deliveries of the same firing name the same export.
const startSchema = z.object({ exportId: z.string().min(1).max(80) });

/** The first step accepts either: what started the run, or what the previous step returned. */
export function toProgress(input: unknown): Progress {
  if (typeof input === "object" && input !== null && "nextPart" in input) {
    return progressSchema.parse(input);
  }
  const start = startSchema.parse(input);
  // "2026-10-12T03:00:00Z" becomes "2026-10-12T030000Z": no colons in an object key.
  return {
    exportId: exportId.parse(start.exportId.replaceAll(":", "")),
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

export const manifestSchema = z.object({
  exportId,
  notes: z.number().int().min(0),
  /** Object keys, in order. Read these and nothing else under the prefix. */
  parts: z.array(z.string()),
});
export type Manifest = z.infer<typeof manifestSchema>;

/** Step Functions matches a Catch on this name. */
export class ExportCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportCorrupt";
  }
}
