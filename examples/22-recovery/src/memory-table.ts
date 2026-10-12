import * as v from "valibot";

import { type Note, noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import {
  decodeCursor,
  encodeCursor,
  type NoteRepository,
} from "@aih/example-05-dynamodb/src/repository.ts";
import type { AttachmentRepository } from "@aih/example-07-uploads/api/src/attachment-repository.ts";
import { type Attachment, attachmentSchema } from "@aih/example-07-uploads/api/src/contract.ts";
import {
  type Inspection,
  type InspectionRepository,
  inspectionSchema,
} from "@aih/example-08-async/src/inspection.ts";

import {
  attachmentKey,
  inspectionKey,
  noteKey,
  ownerKey,
  type TableItem,
  type TableReader,
} from "./items.ts";
import type { NoteVersionStore } from "./table-diff.ts";

type Change = { at: number; key: string; item: TableItem | undefined };

// #region memory-table
/**
 * One table for notes, attachments, and inspections, as in AWS. It remembers
 * every write with its time, which is all point-in-time recovery needs. A
 * stand-in for the idea, not for DynamoDB: no capacity, no latency, no limits.
 */
export class MemoryTable implements TableReader {
  readonly #items = new Map<string, TableItem>();
  readonly #journal: Change[] = [];
  readonly #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  #key = (pk: string, sk: string): string => `${pk}\n${sk}`;

  get(pk: string, sk: string): TableItem | undefined {
    return this.#items.get(this.#key(pk, sk));
  }

  put(item: TableItem & { pk: string; sk: string }): void {
    const key = this.#key(item.pk, item.sk);
    this.#items.set(key, item);
    this.#journal.push({ at: this.#now().getTime(), key, item });
  }

  delete(pk: string, sk: string): TableItem | undefined {
    const key = this.#key(pk, sk);
    const existing = this.#items.get(key);
    if (existing !== undefined) {
      this.#items.delete(key);
      this.#journal.push({ at: this.#now().getTime(), key, item: undefined });
    }
    return existing;
  }

  /** Ascending by sort key, like a Query. */
  query(pk: string, skPrefix: string): TableItem[] {
    const prefix = this.#key(pk, skPrefix);
    return [...this.#items.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .toSorted(([a], [b]) => (a < b ? -1 : 1))
      .map(([, item]) => item);
  }

  async *scan(): AsyncIterable<TableItem> {
    yield* this.#items.values();
  }

  /**
   * What RestoreTableToPointInTime does: a new table holding the items as
   * they were at `at`. This table is not touched, and the new one starts
   * with no history of its own.
   */
  restoreTo(at: Date, now: () => Date = this.#now): MemoryTable {
    const restored = new MemoryTable(now);
    for (const change of this.#journal) {
      if (change.at > at.getTime()) {
        break;
      }
      if (change.item === undefined) {
        restored.#items.delete(change.key);
      } else {
        restored.#items.set(change.key, change.item);
      }
    }
    return restored;
  }
}
// #endregion memory-table

const strip = (item: TableItem): TableItem => {
  const { pk: _pk, sk: _sk, ...body } = item;
  return body;
};

export class TableNoteRepository implements NoteRepository, NoteVersionStore {
  readonly #table: MemoryTable;

  constructor(table: MemoryTable) {
    this.#table = table;
  }

  async create(owner: string, note: Note) {
    if (this.#table.get(ownerKey(owner), noteKey(note.id)) !== undefined) {
      return "already_exists" as const;
    }
    this.#table.put({ pk: ownerKey(owner), sk: noteKey(note.id), ...note });
    return "created" as const;
  }

  // No `await` between a read and the write that depends on it: one step, as a condition is in DynamoDB.
  #read(owner: string, id: string): Note | undefined {
    const item = this.#table.get(ownerKey(owner), noteKey(id));
    return item === undefined ? undefined : v.parse(noteSchema, strip(item));
  }

  async get(owner: string, id: string) {
    return this.#read(owner, id);
  }

  async list(owner: string, options: { limit: number; cursor?: string | undefined }) {
    const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
    const mine = this.#table
      .query(ownerKey(owner), "NOTE#")
      .map((item) => v.parse(noteSchema, strip(item)))
      .toReversed()
      .filter((note) => after === undefined || note.id < after);
    const notes = mine.slice(0, options.limit);
    const last = notes.at(-1);
    return {
      notes,
      nextCursor: mine.length > options.limit && last !== undefined ? encodeCursor(last.id) : null,
    };
  }

  async update(
    owner: string,
    id: string,
    change: { title: string; body: string; expectedVersion: number; updatedAt: string },
  ) {
    const current = this.#read(owner, id);
    if (current === undefined) {
      return { status: "not_found" as const };
    }
    if (current.version !== change.expectedVersion) {
      return { status: "conflict" as const, current };
    }
    const note: Note = {
      ...current,
      title: change.title,
      body: change.body,
      version: current.version + 1,
      updatedAt: change.updatedAt,
    };
    this.#table.put({ pk: ownerKey(owner), sk: noteKey(id), ...note });
    return { status: "updated" as const, note };
  }

  async delete(owner: string, id: string) {
    return this.#table.delete(ownerKey(owner), noteKey(id)) !== undefined;
  }

  async raiseVersion(owner: string, id: string, to: number) {
    const current = this.#read(owner, id);
    if (current === undefined || current.version >= to) {
      return "unchanged" as const;
    }
    this.#table.put({ pk: ownerKey(owner), sk: noteKey(id), ...current, version: to });
    return "raised" as const;
  }
}

export class TableAttachmentRepository implements AttachmentRepository {
  readonly #table: MemoryTable;

  constructor(table: MemoryTable) {
    this.#table = table;
  }

  async create(owner: string, attachment: Attachment) {
    const sk = attachmentKey(attachment.noteId, attachment.id);
    if (this.#table.get(ownerKey(owner), sk) !== undefined) {
      return "already_exists" as const;
    }
    this.#table.put({ pk: ownerKey(owner), sk, ...attachment });
    return "created" as const;
  }

  async get(owner: string, noteId: string, id: string) {
    const item = this.#table.get(ownerKey(owner), attachmentKey(noteId, id));
    return item === undefined ? undefined : v.parse(attachmentSchema, strip(item));
  }

  async listByNote(owner: string, noteId: string) {
    return this.#table
      .query(ownerKey(owner), attachmentKey(noteId, ""))
      .map((item) => v.parse(attachmentSchema, strip(item)));
  }

  async delete(owner: string, noteId: string, id: string) {
    return this.#table.delete(ownerKey(owner), attachmentKey(noteId, id)) !== undefined;
  }
}

export class TableInspectionRepository implements InspectionRepository {
  readonly #table: MemoryTable;

  constructor(table: MemoryTable) {
    this.#table = table;
  }

  async putIfNewer(owner: string, inspection: Inspection) {
    const existing = this.#read(owner, inspection.noteId, inspection.attachmentId);
    if (existing !== undefined && existing.sequencer >= inspection.sequencer) {
      return "not_newer" as const;
    }
    const item = Object.fromEntries(
      Object.entries(inspection).filter(([, value]) => value !== undefined),
    );
    this.#table.put({
      ...item,
      pk: ownerKey(owner),
      sk: inspectionKey(inspection.noteId, inspection.attachmentId),
    });
    return "written" as const;
  }

  async deleteIfOlder(owner: string, noteId: string, attachmentId: string, sequencer: string) {
    const existing = this.#read(owner, noteId, attachmentId);
    if (existing !== undefined && existing.sequencer >= sequencer) {
      return "kept" as const;
    }
    this.#table.delete(ownerKey(owner), inspectionKey(noteId, attachmentId));
    return "deleted" as const;
  }

  #read(owner: string, noteId: string, attachmentId: string): Inspection | undefined {
    const item = this.#table.get(ownerKey(owner), inspectionKey(noteId, attachmentId));
    return item === undefined ? undefined : v.parse(inspectionSchema, strip(item));
  }

  async get(owner: string, noteId: string, attachmentId: string) {
    return this.#read(owner, noteId, attachmentId);
  }
}
