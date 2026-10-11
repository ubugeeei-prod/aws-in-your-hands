import { noteSchema, type Note } from "@aih/example-04-http-api/src/contract.ts";
import type { NoteRepository } from "@aih/example-04-http-api/src/notes.ts";
import { z } from "zod";

// #region storage
/** The four file operations the repository needs. Tests replace them to fail at a chosen step. */
export type FileOps = {
  /** `undefined` when the file does not exist. */
  read(path: string): Promise<string | undefined>;
  /** Writes the whole content and flushes it to the device before resolving. */
  writeDurably(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Flushes the directory entry, so the rename itself survives a power loss. */
  syncDirectory(path: string): Promise<void>;
};

/** Replaces `path` so that a reader sees the old content or the new content, never a mixture. */
export async function replaceFile(ops: FileOps, path: string, content: string): Promise<void> {
  const next = `${path}.next`;
  await ops.writeDurably(next, content);
  await ops.rename(next, path);
  await ops.syncDirectory(path.slice(0, Math.max(path.lastIndexOf("/"), 1)));
}
// #endregion storage

const fileSchema = z.object({ version: z.literal(1), notes: z.array(noteSchema) });

async function load(ops: FileOps, path: string): Promise<Map<string, Note>> {
  const text = await ops.read(path);
  if (text === undefined) {
    return new Map();
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // Starting empty here would overwrite the damaged file with the next write.
    throw new Error(`${path} is not JSON; refusing to start over it`, { cause: error });
  }
  const file = fileSchema.safeParse(json);
  if (!file.success) {
    throw new Error(`${path} does not hold notes in the expected shape; refusing to start over it`);
  }
  return new Map(file.data.notes.map((note) => [note.id, note]));
}

// #region repository
/**
 * Notes in one JSON file. Correct for exactly one process: systemd runs one,
 * and nothing here stops a second one from overwriting the first.
 */
export class FileNoteRepository implements NoteRepository {
  readonly #ops: FileOps;
  readonly #path: string;
  #notes: Map<string, Note>;
  #queue: Promise<unknown> = Promise.resolve();

  private constructor(ops: FileOps, path: string, notes: Map<string, Note>) {
    this.#ops = ops;
    this.#path = path;
    this.#notes = notes;
  }

  static async open(ops: FileOps, path: string): Promise<FileNoteRepository> {
    return new FileNoteRepository(ops, path, await load(ops, path));
  }

  async list(): Promise<Note[]> {
    return [...this.#notes.values()].toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Note | undefined> {
    return this.#notes.get(id);
  }

  async put(note: Note): Promise<void> {
    await this.#commit((notes) => notes.set(note.id, note));
  }

  delete(id: string): Promise<boolean> {
    return this.#commit((notes) => notes.delete(id));
  }

  /** Resolves once every write accepted so far has reached the file, or failed. */
  async idle(): Promise<void> {
    await this.#queue.catch(() => undefined);
  }

  // One write at a time. Memory changes only after the file has: a caller that
  // was told "saved" can be sure a restarted process will read the note.
  #commit<T>(change: (notes: Map<string, Note>) => T): Promise<T> {
    const run = async (): Promise<T> => {
      const next = new Map(this.#notes);
      const result = change(next);
      try {
        await replaceFile(this.#ops, this.#path, `${JSON.stringify({ version: 1, notes: [...next.values()] })}\n`);
      } catch (error) {
        // The rename may or may not have happened. The file decides; memory follows it.
        this.#notes = await load(this.#ops, this.#path).catch(() => this.#notes);
        throw error;
      }
      this.#notes = next;
      return result;
    };
    const result = this.#queue.catch(() => undefined).then(run);
    this.#queue = result;
    return result;
  }
}
// #endregion repository
