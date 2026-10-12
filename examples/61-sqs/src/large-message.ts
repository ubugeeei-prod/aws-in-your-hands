import { createHash } from "node:crypto";

import * as v from "valibot";

// What the Extended Client Libraries for Java and Python do, written out:
// a body over the limit goes to S3, and the message carries where it is.
// This chapter's commands are far below the limit, so nothing here is wired
// into the worker.

export const MAX_MESSAGE_BYTES = 1_048_576;

export type BlobStore = {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
};

const pointerSchema = v.object({
  key: v.pipe(v.string(), v.minLength(1)),
  bytes: v.pipe(v.number(), v.safeInteger(), v.minValue(1)),
  sha256: v.pipe(v.string(), v.regex(/^[0-9a-f]{64}$/)),
});

const size = (text: string): number => new TextEncoder().encode(text).length;
const digest = (text: string): string => createHash("sha256").update(text).digest("hex");

// #region pack
/** `stored` travels as a message attribute, so the consumer knows which of the two it holds. */
export async function pack(
  body: string,
  key: string,
  store: BlobStore,
  limitBytes: number = MAX_MESSAGE_BYTES,
): Promise<{ body: string; stored: boolean }> {
  const bytes = size(body);
  if (bytes <= limitBytes) {
    return { body, stored: false };
  }
  // The object first. A message that points at nothing is worse than an object nobody points at.
  await store.put(key, body);
  return { body: JSON.stringify({ key, bytes, sha256: digest(body) }), stored: true };
}

export async function unpack(
  message: { body: string; stored: boolean },
  store: BlobStore,
): Promise<string> {
  if (!message.stored) {
    return message.body;
  }
  const pointer = v.parse(pointerSchema, JSON.parse(message.body));
  const body = await store.get(pointer.key);
  if (body === undefined) {
    throw new Error(`the payload ${pointer.key} is gone: expired, or never written`);
  }
  if (digest(body) !== pointer.sha256) {
    throw new Error(`the payload ${pointer.key} is not the one the message was sent with`);
  }
  return body;
}
// #endregion pack
