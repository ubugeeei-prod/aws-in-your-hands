import * as v from "valibot";

import {
  attachmentPrefix,
  INDEX,
  INDEX_PK,
  INDEX_SK,
  legacyAttachmentPrefix,
  noteCollection,
  noteSk,
  ownerPk,
  QUOTA_SK,
  RECENT_PREFIX,
  recentSk,
  slugSk,
  tagCountSk,
  tagPrefix,
  tagSk,
} from "./keys.ts";
import { layoutOf, type Phase } from "./layout.ts";
import {
  type Attachment,
  MAX_NOTES_PER_OWNER,
  MAX_PAGE_SIZE,
  noteAttachmentSchema,
  type NoteChange,
  type NoteSummary,
  noteSummarySchema,
  type TaggedNote,
  taggedNoteSchema,
  type TagEntry,
  tagEntrySchema,
} from "./model.ts";
import { decodePageToken, encodePageToken, InvalidPageTokenError } from "./page-token.ts";
import {
  type Planned,
  planAttach,
  planCreate,
  planDetach,
  planRemove,
  planUpdate,
  type Refusal,
} from "./plan.ts";
import type { Item, Table } from "./table.ts";

export type NotebookDeps = {
  table: Table;
  maxNotes?: number;
  /** Where attachments live while their keys are being moved. Once that is over: "new". */
  phase?: Phase;
  /** Waits before a cancelled transaction is tried again. */
  backoff?: (attempt: number) => Promise<void>;
};

/** Other transactions kept holding the same items. Nothing was written. */
export class BusyError extends Error {
  constructor() {
    super("The write kept colliding with other transactions on the same items.");
    this.name = "BusyError";
  }
}

export type UpdateResult =
  | { status: "updated"; note: TaggedNote }
  | { status: "conflict"; current: TaggedNote }
  | { status: "not_found" }
  | { status: "slug_taken" };

const ATTEMPTS = 3;
const pageSize = v.pipe(v.number(), v.safeInteger(), v.minValue(1), v.maxValue(MAX_PAGE_SIZE));
const counter = (name: string) => v.object({ [name]: v.optional(v.number(), 0) });

export function createNotebook(deps: NotebookDeps) {
  const { table } = deps;
  const maxNotes = deps.maxNotes ?? MAX_NOTES_PER_OWNER;
  const layout = layoutOf(deps.phase ?? "new");
  const backoff = deps.backoff ?? (async () => {});

  // #region commit
  /** One write goes alone, at half the price. More than one, or a check, goes as a transaction. */
  async function commit(planned: Planned[]): Promise<"ok" | Refusal> {
    const writes = planned.map((entry) => entry.write);
    const [only] = writes;
    if (writes.length === 1 && only !== undefined && only.kind !== "check") {
      const result = await table.write(only);
      return result === "ok" ? "ok" : refusalAt(planned, 0);
    }
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const result = await table.transact(writes);
      if (result.ok) {
        return "ok";
      }
      const refused = result.reasons.indexOf("condition_failed");
      if (refused !== -1) {
        return refusalAt(planned, refused);
      }
      // Another transaction held one of these items. The SDK does not retry
      // a cancelled transaction, so this loop does, and gives up after a few.
      await backoff(attempt);
    }
    throw new BusyError();
  }
  // #endregion commit

  function refusalAt(planned: Planned[], index: number): Refusal {
    const refusal = planned[index]?.refusal;
    if (refusal === undefined) {
      throw new Error("A write without a condition was refused.");
    }
    return refusal;
  }

  async function read(owner: string, id: string): Promise<TaggedNote | undefined> {
    const item = await table.get({ pk: ownerPk(owner), sk: noteSk(id) }, { consistent: true });
    return item === undefined ? undefined : v.parse(taggedNoteSchema, item);
  }

  async function queryAll(owner: string, sk: NonNullable<Parameters<Table["query"]>[0]["sk"]>) {
    const items: Item[] = [];
    let after: Record<string, string> | undefined;
    do {
      const page = await table.query({
        pk: ownerPk(owner),
        sk,
        consistent: true,
        ...(after === undefined ? {} : { after }),
      });
      items.push(...page.items);
      after = page.last;
    } while (after !== undefined);
    return items;
  }

  // #region sweep
  /** What is left under a note once the note is gone. Safe to run again. */
  async function sweep(owner: string, id: string): Promise<void> {
    const prefixes = [attachmentPrefix(id), legacyAttachmentPrefix(id)];
    for (const beginsWith of prefixes) {
      for (const item of await queryAll(owner, { beginsWith })) {
        await table.write({ kind: "delete", key: { pk: item.pk, sk: item.sk } });
      }
    }
  }
  // #endregion sweep

  return {
    // #region create
    async create(
      owner: string,
      note: TaggedNote,
    ): Promise<"created" | "already_exists" | "slug_taken" | "quota_exceeded"> {
      const result = await commit(planCreate(owner, note, maxNotes));
      if (result === "stale" || result === "note_missing") {
        throw new Error(`Unexpected refusal: ${result}`);
      }
      return result === "ok" ? "created" : result;
    },
    // #endregion create

    // #region collection
    /** The note and its attachments from a single Query, read after every write that succeeded. */
    async getWithAttachments(
      owner: string,
      id: string,
    ): Promise<{ note: TaggedNote; attachments: Attachment[] } | undefined> {
      if (layout.read === "legacy") {
        const note = await read(owner, id);
        if (note === undefined) {
          return undefined;
        }
        const items = await queryAll(owner, { beginsWith: legacyAttachmentPrefix(id) });
        return { note, attachments: items.map((item) => v.parse(noteAttachmentSchema, item)) };
      }
      const items = await queryAll(owner, { between: noteCollection(id) });
      const [first, ...rest] = items;
      // The note sorts first. Without it, whatever follows belongs to a note that is gone.
      if (first === undefined || first.sk !== noteSk(id)) {
        return undefined;
      }
      return {
        note: v.parse(taggedNoteSchema, first),
        attachments: rest
          .filter((item) => item.sk.startsWith(attachmentPrefix(id)))
          .map((item) => v.parse(noteAttachmentSchema, item)),
      };
    },
    // #endregion collection

    // #region update
    async update(owner: string, id: string, change: NoteChange): Promise<UpdateResult> {
      // Read to learn which tag and slug items must change. The condition on
      // the write, not this read, is what refuses a stale update.
      const current = await read(owner, id);
      if (current === undefined) {
        return { status: "not_found" };
      }
      if (current.version !== change.expectedVersion) {
        return { status: "conflict", current };
      }
      const { expectedVersion: _, ...fields } = change;
      const next = v.parse(taggedNoteSchema, {
        ...current,
        ...fields,
        version: current.version + 1,
      });
      const result = await commit(planUpdate(owner, current, next));
      if (result === "ok") {
        return { status: "updated", note: next };
      }
      if (result === "slug_taken") {
        return { status: "slug_taken" };
      }
      const latest = await read(owner, id);
      return latest === undefined
        ? { status: "not_found" }
        : { status: "conflict", current: latest };
    },
    // #endregion update

    // #region remove
    async remove(owner: string, id: string): Promise<boolean> {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const current = await read(owner, id);
        if (current === undefined) {
          // A delete that stopped half way is finished by asking again.
          await sweep(owner, id);
          return false;
        }
        if ((await commit(planRemove(owner, current))) === "ok") {
          // From here no attachment can be added: `attach` requires the note.
          await sweep(owner, id);
          return true;
        }
        // The note changed between the read and the delete. Read it again.
      }
      throw new BusyError();
    },
    // #endregion remove

    // #region attach
    async attach(
      owner: string,
      attachment: Attachment,
    ): Promise<"created" | "already_exists" | "note_missing"> {
      const result = await commit(planAttach(owner, attachment, layout.write));
      if (result === "ok") {
        return "created";
      }
      if (result === "already_exists" || result === "note_missing") {
        return result;
      }
      throw new Error(`Unexpected refusal: ${result}`);
    },
    // #endregion attach

    async detach(owner: string, noteId: string, id: string): Promise<void> {
      await commit(planDetach(owner, noteId, id, layout.write));
    },

    // #region list-recent
    /** Most recently updated first, from the index: it can be a moment behind the table. */
    async listRecent(
      owner: string,
      options: { limit: number; token?: string | undefined },
    ): Promise<{ notes: NoteSummary[]; nextToken: string | null }> {
      const position = options.token === undefined ? undefined : decodePageToken(options.token);
      if (position !== undefined && position.list !== "recent") {
        throw new InvalidPageTokenError();
      }
      const page = await table.query({
        index: INDEX,
        pk: ownerPk(owner),
        sk: { beginsWith: RECENT_PREFIX },
        descending: true,
        limit: v.parse(pageSize, options.limit),
        // Rebuilt from the caller's own identity: a token cannot point into another owner's notes.
        ...(position === undefined
          ? {}
          : {
              after: {
                pk: ownerPk(owner),
                sk: noteSk(position.noteId),
                [INDEX_PK]: ownerPk(owner),
                [INDEX_SK]: recentSk(position.updatedAt, position.noteId),
              },
            }),
      });
      const notes = page.items.map((item) => v.parse(noteSummarySchema, item));
      const final = notes.at(-1);
      return {
        notes,
        nextToken:
          page.last === undefined || final === undefined
            ? null
            : encodePageToken({ list: "recent", updatedAt: final.updatedAt, noteId: final.id }),
      };
    },
    // #endregion list-recent

    // #region list-by-tag
    /** Newest note first. Reads the tag's own items, so the notes are not touched. */
    async listByTag(
      owner: string,
      tag: string,
      options: { limit: number; token?: string | undefined },
    ): Promise<{ entries: TagEntry[]; nextToken: string | null }> {
      const position = options.token === undefined ? undefined : decodePageToken(options.token);
      if (position !== undefined && (position.list !== "tag" || position.tag !== tag)) {
        throw new InvalidPageTokenError();
      }
      const page = await table.query({
        pk: ownerPk(owner),
        sk: { beginsWith: tagPrefix(tag) },
        descending: true,
        limit: v.parse(pageSize, options.limit),
        ...(position === undefined
          ? {}
          : { after: { pk: ownerPk(owner), sk: tagSk(tag, position.noteId) } }),
      });
      const entries = page.items.map((item) => v.parse(tagEntrySchema, item));
      const final = entries.at(-1);
      return {
        entries,
        nextToken:
          page.last === undefined || final === undefined
            ? null
            : encodePageToken({ list: "tag", tag, noteId: final.noteId }),
      };
    },
    // #endregion list-by-tag

    // #region counts
    /** Exact: the counter changes in the same transaction as the notes it counts. */
    async count(owner: string): Promise<number> {
      const item = await table.get({ pk: ownerPk(owner), sk: QUOTA_SK }, { consistent: true });
      return v.parse(counter("noteCount"), item ?? {})["noteCount"] ?? 0;
    },

    /** Derived from the stream, so it trails the tags by however far the consumer is behind. */
    async tagCount(owner: string, tag: string): Promise<number> {
      const item = await table.get({ pk: ownerPk(owner), sk: tagCountSk(tag) });
      return v.parse(counter("count"), item ?? {})["count"] ?? 0;
    },
    // #endregion counts

    async findBySlug(owner: string, slug: string): Promise<TaggedNote | undefined> {
      const item = await table.get({ pk: ownerPk(owner), sk: slugSk(slug) }, { consistent: true });
      const pointer = v.safeParse(v.object({ noteId: v.string() }), item);
      return pointer.success ? read(owner, pointer.output.noteId) : undefined;
    },
  };
}

export type Notebook = ReturnType<typeof createNotebook>;
