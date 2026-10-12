import type { AudioCache } from "./audio-cache.ts";

// A stand-in for the bucket, not an emulation of S3. It keeps the two conditions the app
// relies on (create only if absent, replace only if unchanged) and nothing else.

type Entry = { body: Uint8Array; contentType: string; etag: string };

export class InMemoryAudioCache implements AudioCache {
  readonly #objects = new Map<string, Entry>();
  readonly #baseUrl: string;
  #writes = 0;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  #put(key: string, body: Uint8Array, contentType: string): string {
    this.#writes += 1;
    const etag = `"${this.#writes}"`;
    this.#objects.set(key, { body, contentType, etag });
    return etag;
  }

  async exists(key: string) {
    return this.#objects.has(key);
  }

  async create(key: string, body: Uint8Array, contentType: string) {
    return this.#objects.has(key)
      ? ({ created: false } as const)
      : ({ created: true, etag: this.#put(key, body, contentType) } as const);
  }

  async read(key: string) {
    const entry = this.#objects.get(key);
    return entry === undefined ? undefined : { body: entry.body, etag: entry.etag };
  }

  async replace(key: string, etag: string, body: Uint8Array, contentType: string) {
    return this.#objects.get(key)?.etag === etag
      ? ({ replaced: true, etag: this.#put(key, body, contentType) } as const)
      : ({ replaced: false } as const);
  }

  async presignView(key: string, expiresInSeconds: number) {
    // Not signed: the development server listens on loopback only.
    return `${this.#baseUrl}/local/audio/${key}?expires-in=${expiresInSeconds}`;
  }

  /** What the development server sends for a GET on a view URL. */
  get(key: string): { body: Uint8Array; contentType: string } | undefined {
    return this.#objects.get(key);
  }

  /** For tests: what a lifecycle rule or an operator would do. */
  remove(key: string): void {
    this.#objects.delete(key);
  }

  keys(prefix: string): string[] {
    return [...this.#objects.keys()].filter((key) => key.startsWith(prefix)).toSorted();
  }
}
