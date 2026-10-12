import { type KeyParts, objectKey } from "@aih/example-07-uploads/api/src/keys.ts";

// #region keys
// u/ is chapter 07's: what the user uploaded. g/ is what a model generated from it.
// c/ holds claims: who is generating right now. The owner comes second in all three.
export const GENERATED_PREFIX = "g/";
export const CLAIM_PREFIX = "c/";

export type MediaKeys = { source: string; description: string; claim: string };

/** Throws when a part could not be a key segment, as chapter 07's `objectKey` does. */
export function mediaKeys(parts: KeyParts): MediaKeys {
  const source = objectKey(parts);
  const path = `${parts.owner}/${parts.noteId}/${parts.attachmentId}`;
  return {
    source,
    description: `${GENERATED_PREFIX}${path}/description.json`,
    claim: `${CLAIM_PREFIX}${path}/description.json`,
  };
}
// #endregion keys

// #region port
export type StoredObject = { eTag: string; contentType: string; size: number };

/** A place that holds objects and can refuse a write. S3 in AWS, a Map on a laptop. */
export type Media = {
  head(key: string): Promise<StoredObject | undefined>;
  getText(key: string): Promise<{ text: string; eTag: string } | undefined>;
  /** Writes only if nothing is stored under the key. Check and write are one step. */
  putIfAbsent(key: string, text: string): Promise<"created" | "exists">;
  /** Overwrites only the object that still has this ETag. */
  replaceIfMatch(key: string, eTag: string, text: string): Promise<"replaced" | "changed">;
  /** Deleting a key that is not there is not an error. */
  delete(key: string): Promise<void>;
};
// #endregion port
