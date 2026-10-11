import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { ObjectStore } from "./object-store.ts";

// A stand-in for S3 on a laptop, not an emulation of it. It refuses the same
// four things the POST policy refuses (wrong key, wrong type, too large, too
// late) so that the app's own logic can be exercised. It says nothing about
// how S3 words its errors, about CORS, IAM, or lifecycle rules.

const policySchema = z.object({
  key: z.string(),
  contentType: z.string(),
  maxBytes: z.number(),
  expiresAt: z.number(),
});

type State = "pending" | "attached";
type Entry = { body: Uint8Array; contentType: string; lastModified: Date; state: State };

export type Received = { ok: true } | { ok: false; reason: "forged" | "expired" | "mismatch" | "size" };

export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, Entry>();
  readonly #baseUrl: string;
  readonly #secret: string;
  readonly #now: () => Date;

  constructor(options: { baseUrl: string; secret: string; now: () => Date }) {
    this.#baseUrl = options.baseUrl;
    this.#secret = options.secret;
    this.#now = options.now;
  }

  #sign(text: string): string {
    return createHmac("sha256", this.#secret).update(text).digest("hex");
  }

  #signed(text: string, signature: string | undefined): boolean {
    const expected = Buffer.from(this.#sign(text));
    const given = Buffer.from(signature ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  async presignUpload(input: { key: string; contentType: string; maxBytes: number; expiresInSeconds: number }) {
    const policy = Buffer.from(
      JSON.stringify({
        key: input.key,
        contentType: input.contentType,
        maxBytes: input.maxBytes,
        expiresAt: this.#now().getTime() + input.expiresInSeconds * 1000,
      }),
    ).toString("base64url");
    return {
      url: `${this.#baseUrl}/local/s3`,
      fields: { key: input.key, "Content-Type": input.contentType, policy, signature: this.#sign(policy) },
    };
  }

  /** What the development server calls when the browser's form arrives. */
  receive(fields: Record<string, string | undefined>, body: Uint8Array): Received {
    if (fields["policy"] === undefined || !this.#signed(fields["policy"], fields["signature"])) {
      return { ok: false, reason: "forged" };
    }
    const policy = policySchema.parse(JSON.parse(Buffer.from(fields["policy"], "base64url").toString("utf8")));
    if (this.#now().getTime() > policy.expiresAt) {
      return { ok: false, reason: "expired" };
    }
    if (fields["key"] !== policy.key || fields["Content-Type"] !== policy.contentType) {
      return { ok: false, reason: "mismatch" };
    }
    if (body.byteLength < 1 || body.byteLength > policy.maxBytes) {
      return { ok: false, reason: "size" };
    }
    // Like S3, a second upload under the same key replaces the first.
    this.#objects.set(policy.key, {
      body,
      contentType: policy.contentType,
      lastModified: this.#now(),
      state: "pending",
    });
    return { ok: true };
  }

  async head(key: string) {
    const entry = this.#objects.get(key);
    return entry === undefined
      ? undefined
      : { size: entry.body.byteLength, contentType: entry.contentType, lastModified: entry.lastModified };
  }

  async markAttached(key: string) {
    const entry = this.#objects.get(key);
    if (entry === undefined) {
      throw new Error(`NoSuchKey: ${key}`);
    }
    entry.state = "attached";
  }

  async presignView(key: string, expiresInSeconds: number) {
    const expires = String(this.#now().getTime() + expiresInSeconds * 1000);
    const url = new URL(`${this.#baseUrl}/local/s3/${key}`);
    url.searchParams.set("expires", expires);
    url.searchParams.set("signature", this.#sign(`${key}\n${expires}`));
    return url.toString();
  }

  /** What the development server calls for a GET on a view URL. */
  read(key: string, expires: string | undefined, signature: string | undefined) {
    if (expires === undefined || !this.#signed(`${key}\n${expires}`, signature)) {
      return undefined;
    }
    if (this.#now().getTime() > Number(expires)) {
      return undefined;
    }
    const entry = this.#objects.get(key);
    return entry === undefined ? undefined : { body: entry.body, contentType: entry.contentType };
  }

  async delete(key: string) {
    this.#objects.delete(key);
  }

  async *list(prefix: string) {
    for (const [key, entry] of [...this.#objects.entries()].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
      if (key.startsWith(prefix)) {
        yield { key, lastModified: entry.lastModified };
      }
    }
  }

  /** For tests: "pending" while the object carries the tag, undefined when it is not there. */
  stateOf(key: string): State | undefined {
    return this.#objects.get(key)?.state;
  }
}
