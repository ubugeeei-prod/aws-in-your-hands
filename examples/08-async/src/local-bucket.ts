import { createHash } from "node:crypto";

import {
  InMemoryObjectStore,
  type Received,
} from "@aih/example-07-uploads/api/src/memory-object-store.ts";

import type { ObjectReader, ReadResult } from "./object-reader.ts";

type Current = { body: Uint8Array; eTag: string; contentType: string };

// #region local-bucket
/**
 * Chapter 07's in-memory store, plus the two things this chapter needs from
 * S3: it announces each create and delete in the shape of an S3 event, and it
 * lets the worker read "these exact bytes" by ETag.
 */
export class LocalBucket extends InMemoryObjectStore implements ObjectReader {
  readonly #current = new Map<string, Current>();
  readonly #notify: (body: string) => void;
  #sequence = 0;

  constructor(options: {
    baseUrl: string;
    secret: string;
    now: () => Date;
    notify: (body: string) => void;
  }) {
    super(options);
    this.#notify = options.notify;
  }

  #announce(eventName: string, key: string, object: { size?: number; eTag?: string }): void {
    // Always growing here. S3 only promises that, for one key, later is greater.
    const sequencer = (++this.#sequence).toString(16).toUpperCase().padStart(18, "0");
    this.#notify(
      JSON.stringify({
        Records: [
          { eventVersion: "2.1", eventName, s3: { object: { key, ...object, sequencer } } },
        ],
      }),
    );
  }

  override receive(fields: Record<string, string | undefined>, body: Uint8Array): Received {
    const received = super.receive(fields, body);
    const key = fields["key"];
    if (received.ok && key !== undefined) {
      const eTag = createHash("md5").update(body).digest("hex");
      this.#current.set(key, { body, eTag, contentType: fields["Content-Type"] ?? "" });
      this.#announce("ObjectCreated:Post", key, { size: body.byteLength, eTag });
    }
    return received;
  }

  override async delete(key: string): Promise<void> {
    await super.delete(key);
    if (this.#current.delete(key)) {
      this.#announce("ObjectRemoved:Delete", key, {});
    }
  }

  async readExact(key: string, eTag: string, maxBytes: number): Promise<ReadResult> {
    const current = this.#current.get(key);
    if (current === undefined) {
      return { status: "gone" };
    }
    if (current.eTag !== eTag) {
      return { status: "changed" };
    }
    return {
      status: "found",
      bytes: current.body.subarray(0, maxBytes),
      size: current.body.byteLength,
      contentType: current.contentType,
    };
  }
}
// #endregion local-bucket
