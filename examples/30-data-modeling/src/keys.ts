// Every key this table uses, in one place. Nothing else in the chapter builds a key by hand.

// #region keys
export const INDEX = "gsi1";
export const INDEX_PK = "gsi1pk";
export const INDEX_SK = "gsi1sk";
// What a list shows, and nothing more: the body stays in the table.
export const INDEX_PROJECTION = ["id", "title", "version", "createdAt", "updatedAt", "tags"];
// Epoch seconds. DynamoDB deletes an item some time after this passes.
export const TTL_ATTRIBUTE = "expiresAt";

export const ownerPk = (owner: string): string => `OWNER#${owner}`;

export const noteSk = (noteId: string): string => `NOTE#${noteId}`;
// Directly after its note in sort order, so one Query returns both.
export const attachmentSk = (noteId: string, id: string): string =>
  `NOTE#${noteId}#ATTACHMENT#${id}`;
export const tagSk = (tag: string, noteId: string): string => `TAG#${tag}#NOTE#${noteId}`;
export const slugSk = (slug: string): string => `SLUG#${slug}`;
// Chapter 05's counter, under the name it already has.
export const QUOTA_SK = "QUOTA";
export const tagCountSk = (tag: string): string => `TAGCOUNT#${tag}`;
export const appliedSk = (eventId: string): string => `APPLIED#${eventId}`;

// Where chapter 07 put attachments. Read and written only while the keys are being moved.
export const legacyAttachmentSk = (noteId: string, id: string): string =>
  `ATTACHMENT#${noteId}#${id}`;
// #endregion keys

// #region ranges
/** The note and everything stored under it. "#" sorts below every character an ID can hold. */
export const noteCollection = (noteId: string): [string, string] => [
  noteSk(noteId),
  `${noteSk(noteId)}#~`,
];
export const attachmentPrefix = (noteId: string): string => `${noteSk(noteId)}#ATTACHMENT#`;
export const legacyAttachmentPrefix = (noteId: string): string => `ATTACHMENT#${noteId}#`;
export const tagPrefix = (tag: string): string => `TAG#${tag}#NOTE#`;
// #endregion ranges

// #region recent
export const RECENT_PREFIX = "UPDATED#";

/**
 * Sort keys compare as text. Chapter 04's timestamp allows any number of
 * fraction digits, so it is rewritten to the one width `toISOString` gives.
 */
export const recentSk = (updatedAt: string, noteId: string): string =>
  `${RECENT_PREFIX}${new Date(updatedAt).toISOString()}#${noteId}`;
// #endregion recent

const TAG_SK = /^TAG#([a-z0-9][a-z0-9-]{0,31})#NOTE#([0-9a-z]{1,64})$/;
const LEGACY_ATTACHMENT_SK = /^ATTACHMENT#([0-9a-z]{1,64})#([0-9a-z]{1,64})$/;
const NOTE_SK = /^NOTE#[0-9a-z]{1,64}$/;

export function parseTagSk(sk: string): { tag: string; noteId: string } | undefined {
  const [, tag, noteId] = TAG_SK.exec(sk) ?? [];
  return tag === undefined || noteId === undefined ? undefined : { tag, noteId };
}

export function parseLegacyAttachmentSk(sk: string): { noteId: string; id: string } | undefined {
  const [, noteId, id] = LEGACY_ATTACHMENT_SK.exec(sk) ?? [];
  return noteId === undefined || id === undefined ? undefined : { noteId, id };
}

/** A note itself, not something stored under one. `begins_with(sk, "NOTE#")` cannot tell them apart. */
export const isNoteSk = (sk: string): boolean => NOTE_SK.test(sk);
