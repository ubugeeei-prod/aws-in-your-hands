// #region port
export type Metadata = Record<string, string>;

export type ExportStore = {
  /** Writes only if nothing is stored under the key yet. The first writer wins. */
  putIfAbsent(key: string, body: string, metadata: Metadata): Promise<"written" | "exists">;
  /** The metadata stored with the object, or undefined if there is none. */
  head(key: string): Promise<Metadata | undefined>;
  list(prefix: string): Promise<string[]>;
  /** Deleting what is already gone is not an error. */
  delete(key: string): Promise<void>;
};
// #endregion port

export class MemoryExportStore implements ExportStore {
  readonly #objects = new Map<string, { body: string; metadata: Metadata }>();

  async putIfAbsent(key: string, body: string, metadata: Metadata) {
    if (this.#objects.has(key)) {
      return "exists" as const;
    }
    this.#objects.set(key, { body, metadata });
    return "written" as const;
  }

  async head(key: string) {
    return this.#objects.get(key)?.metadata;
  }

  async list(prefix: string) {
    return [...this.#objects.keys()].filter((key) => key.startsWith(prefix)).toSorted();
  }

  async delete(key: string) {
    this.#objects.delete(key);
  }

  /** Not part of the port: lets a test or the local run look at what was written. */
  read(key: string): string | undefined {
    return this.#objects.get(key)?.body;
  }
}
