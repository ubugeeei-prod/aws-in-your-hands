// #region keys
// u/<owner>/<note id>/<attachment id>. Every part comes from the server: the
// owner from the verified token, the note from a lookup, the ID from the clock
// and a random suffix. Nothing the browser typed ends up in a key.
export const KEY_PREFIX = "u/";

const SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

export type KeyParts = { owner: string; noteId: string; attachmentId: string };

export function isKeySegment(value: string): boolean {
  return SEGMENT.test(value);
}

export function objectKey(parts: KeyParts): string {
  for (const [name, value] of Object.entries(parts)) {
    // A "/" or ".." in any part would let one user's key land under another's prefix.
    if (!isKeySegment(value)) {
      throw new Error(`${name} cannot be used in an object key`);
    }
  }
  return `${KEY_PREFIX}${parts.owner}/${parts.noteId}/${parts.attachmentId}`;
}

export function parseObjectKey(key: string): KeyParts | undefined {
  if (!key.startsWith(KEY_PREFIX)) {
    return undefined;
  }
  const [owner, noteId, attachmentId, ...rest] = key.slice(KEY_PREFIX.length).split("/");
  if (
    owner === undefined ||
    noteId === undefined ||
    attachmentId === undefined ||
    rest.length > 0
  ) {
    return undefined;
  }
  const parts = { owner, noteId, attachmentId };
  return Object.values(parts).every(isKeySegment) ? parts : undefined;
}
// #endregion keys
