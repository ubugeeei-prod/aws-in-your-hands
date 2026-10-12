import type { Media, StoredObject } from "./media.ts";

// #region memory
/**
 * The three S3 behaviours the job relies on, and no others: a PutObject with
 * `If-None-Match: *` succeeds only when the key is empty, one with `If-Match` only when
 * the ETag is unchanged, and whichever of two such writes finishes first wins. S3's 409
 * for a write that races a delete is not modelled.
 */
export class MemoryMedia implements Media {
  readonly #objects = new Map<string, { body: Uint8Array; contentType: string; eTag: string }>();
  #writes = 0;

  #store(key: string, body: Uint8Array, contentType: string): void {
    this.#writes += 1;
    this.#objects.set(key, { body, contentType, eTag: `"etag-${this.#writes}"` });
  }

  /** An upload, as chapter 07 would have left it. */
  seed(key: string, body: Uint8Array, contentType: string): void {
    this.#store(key, body, contentType);
  }

  keys(prefix = ""): string[] {
    return [...this.#objects.keys()].filter((key) => key.startsWith(prefix)).toSorted();
  }

  async head(key: string): Promise<StoredObject | undefined> {
    const object = this.#objects.get(key);
    return object === undefined
      ? undefined
      : { eTag: object.eTag, contentType: object.contentType, size: object.body.byteLength };
  }

  async getText(key: string) {
    const object = this.#objects.get(key);
    return object === undefined
      ? undefined
      : { text: new TextDecoder().decode(object.body), eTag: object.eTag };
  }

  // No `await` between the check and the write in either method: one step, as in S3.
  async putIfAbsent(key: string, text: string) {
    if (this.#objects.has(key)) {
      return "exists" as const;
    }
    this.#store(key, new TextEncoder().encode(text), "application/json");
    return "created" as const;
  }

  async replaceIfMatch(key: string, eTag: string, text: string) {
    if (this.#objects.get(key)?.eTag !== eTag) {
      return "changed" as const;
    }
    this.#store(key, new TextEncoder().encode(text), "application/json");
    return "replaced" as const;
  }

  async delete(key: string): Promise<void> {
    this.#objects.delete(key);
  }
}
// #endregion memory
