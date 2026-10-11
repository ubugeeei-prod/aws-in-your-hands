import type { Attachment } from "./contract.ts";

// #region interface
// A record exists only for an upload that was checked and accepted. There is
// no "pending" row: an upload that never finishes leaves nothing here.
export interface AttachmentRepository {
  /** Never overwrites. Finishing the same upload twice finds the first record. */
  create(owner: string, attachment: Attachment): Promise<"created" | "already_exists">;
  get(owner: string, noteId: string, id: string): Promise<Attachment | undefined>;
  /** Oldest first. */
  listByNote(owner: string, noteId: string): Promise<Attachment[]>;
  delete(owner: string, noteId: string, id: string): Promise<boolean>;
}
// #endregion interface

export class InMemoryAttachmentRepository implements AttachmentRepository {
  readonly #records = new Map<string, Attachment>();

  #key = (owner: string, noteId: string, id: string): string => `${owner}/${noteId}/${id}`;

  async create(owner: string, attachment: Attachment) {
    const key = this.#key(owner, attachment.noteId, attachment.id);
    if (this.#records.has(key)) {
      return "already_exists" as const;
    }
    this.#records.set(key, attachment);
    return "created" as const;
  }

  async get(owner: string, noteId: string, id: string) {
    return this.#records.get(this.#key(owner, noteId, id));
  }

  async listByNote(owner: string, noteId: string) {
    return [...this.#records.entries()]
      .filter(([key]) => key.startsWith(`${owner}/${noteId}/`))
      .map(([, attachment]) => attachment)
      .toSorted((a, b) => (a.id < b.id ? -1 : 1));
  }

  async delete(owner: string, noteId: string, id: string) {
    return this.#records.delete(this.#key(owner, noteId, id));
  }
}
