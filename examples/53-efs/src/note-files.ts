import * as v from "valibot";

import { noteSchema, type Note } from "@aih/example-04-http-api/src/contract.ts";
import {
  MAX_NOTES,
  NoteLimitError,
  type NoteRepository,
} from "@aih/example-04-http-api/src/notes.ts";
import type { FileOps } from "@aih/example-23-ec2/src/file-notes.ts";

// #region ops
/** Chapter 23's four file operations, plus the three a directory of files needs. */
export type DirOps = FileOps & {
  /** Creates the directory and its parents. Not an error when it exists. */
  ensureDirectory(path: string): Promise<void>;
  /** File names in the directory, in no particular order. */
  list(directory: string): Promise<string[]>;
  /** `false` when there was nothing to remove. */
  remove(path: string): Promise<boolean>;
};
// #endregion ops

// #region layout
// The ID arrives from the URL. Anything outside this set could name a file outside the directory.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SUFFIX = ".json";

/** Where everything lives under the mount point. Both directories are on the same file system. */
export function layout(root: string) {
  const notes = `${root}/notes`;
  const incoming = `${root}/incoming`;
  return {
    notes,
    incoming,
    /** `undefined` for an ID that is not safe to use as a file name. */
    note: (id: string): string | undefined =>
      SAFE_ID.test(id) ? `${notes}/${id}${SUFFIX}` : undefined,
    /** A name no other writer will pick: the token is different for every write. */
    temp: (id: string, token: string): string => `${incoming}/${id}.${token}${SUFFIX}`,
  };
}
// #endregion layout

export type DirectoryNoteOptions = {
  /** Unique per write, across every process that mounts the file system. */
  newToken: () => string;
  maxNotes?: number;
};

// #region repository
/**
 * One file per note, and nothing kept in memory: every process that mounts the
 * directory reads what the others wrote.
 */
export class DirectoryNoteRepository implements NoteRepository {
  readonly #ops: DirOps;
  readonly #paths: ReturnType<typeof layout>;
  readonly #newToken: () => string;
  readonly #maxNotes: number;

  private constructor(ops: DirOps, root: string, options: DirectoryNoteOptions) {
    this.#ops = ops;
    this.#paths = layout(root);
    this.#newToken = options.newToken;
    this.#maxNotes = options.maxNotes ?? MAX_NOTES;
  }

  static async open(
    ops: DirOps,
    root: string,
    options: DirectoryNoteOptions,
  ): Promise<DirectoryNoteRepository> {
    const repository = new DirectoryNoteRepository(ops, root, options);
    await ops.ensureDirectory(repository.#paths.notes);
    await ops.ensureDirectory(repository.#paths.incoming);
    return repository;
  }

  async list(): Promise<Note[]> {
    const names = await this.#noteFiles();
    const notes = await Promise.all(
      names.map((name) => this.#read(`${this.#paths.notes}/${name}`)),
    );
    // A file listed a moment ago may have been deleted by another process since.
    return notes
      .filter((note) => note !== undefined)
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(id: string): Promise<Note | undefined> {
    const path = this.#paths.note(id);
    return path === undefined ? undefined : this.#read(path);
  }

  async put(note: Note): Promise<void> {
    const path = this.#paths.note(note.id);
    if (path === undefined) {
      throw new Error("the note's ID cannot be used as a file name");
    }
    // Counted, then written: two writers at the limit can both get in. The limit bounds the bill, not the count.
    const names = await this.#noteFiles();
    if (!names.includes(`${note.id}${SUFFIX}`) && names.length >= this.#maxNotes) {
      throw new NoteLimitError(this.#maxNotes);
    }

    const temp = this.#paths.temp(note.id, this.#newToken());
    try {
      await this.#ops.writeDurably(temp, `${JSON.stringify(note)}\n`);
      // The only step a reader can see. Before it the old file is there, after it the new one.
      await this.#ops.rename(temp, path);
    } catch (error) {
      await this.#ops.remove(temp).catch(() => false);
      throw error;
    }
    await this.#ops.syncDirectory(this.#paths.notes);
  }

  async delete(id: string): Promise<boolean> {
    const path = this.#paths.note(id);
    return path === undefined ? false : this.#ops.remove(path);
  }

  async #noteFiles(): Promise<string[]> {
    return (await this.#ops.list(this.#paths.notes)).filter((name) => name.endsWith(SUFFIX));
  }

  async #read(path: string): Promise<Note | undefined> {
    const text = await this.#ops.read(path);
    if (text === undefined) {
      return undefined;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      // Never skipped: a file here that is not whole means the write path is broken.
      throw new Error(`${path} is not a whole note`, { cause: error });
    }
    const note = v.safeParse(noteSchema, json);
    if (!note.success) {
      throw new Error(`${path} does not hold a note in the expected shape`);
    }
    return note.output;
  }
}
// #endregion repository
