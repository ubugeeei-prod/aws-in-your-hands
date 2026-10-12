import { SCHEMA_VERSION, SOURCE } from "./contract.ts";

// #region rules
// One pattern per consumer. The stack hands these to EventBridge and the
// tests hand them to src/pattern.ts, so both read the same objects.
export const RULES = {
  // Every change to a note.
  timeline: {
    source: [SOURCE],
    "detail-type": [{ prefix: "Note" }],
    detail: { version: [SCHEMA_VERSION] },
  },
  // Only the changes that move the number of notes.
  counter: {
    source: [SOURCE],
    "detail-type": ["NoteCreated", "NoteDeleted"],
    detail: { version: [SCHEMA_VERSION] },
  },
  // Only inspections that failed, and only the first time they are told: a
  // notice cannot be taken back, so a replayed event is not let through.
  rejections: {
    source: [SOURCE],
    "detail-type": ["AttachmentInspected"],
    "replay-name": [{ exists: false }],
    detail: { version: [SCHEMA_VERSION], verdict: ["rejected"] },
  },
} as const;
export type RuleName = keyof typeof RULES;

/** What the archive keeps: everything this application publishes. */
export const ARCHIVE_PATTERN = { source: [SOURCE] } as const;
// #endregion rules

// #region retention
export const ARCHIVE_RETENTION_DAYS = 7;
// A replay can bring back anything the archive still holds. The marker that
// says "already counted" has to outlive it.
export const COUNTED_MARKER_DAYS = 30;
// #endregion retention

// #region pipe-filter
// Which stream records the pipe lets through: notes and inspection records.
// Attachments, quota counters, and anything added later stay out.
export const PIPE_FILTER = {
  dynamodb: { Keys: { sk: { S: [{ prefix: "NOTE#" }, { prefix: "INSPECTION#" }] } } },
} as const;
// #endregion pipe-filter
