import {
  attachmentSk,
  INDEX_PK,
  INDEX_SK,
  legacyAttachmentSk,
  noteSk,
  ownerPk,
  QUOTA_SK,
  recentSk,
  slugSk,
  tagSk,
} from "./keys.ts";
import type { Layout } from "./layout.ts";
import type { Attachment, TaggedNote } from "./model.ts";
import type { Item, Key, Write } from "./table.ts";

// What the caller is told when the condition on a write does not hold.
export type Refusal = "already_exists" | "slug_taken" | "quota_exceeded" | "stale" | "note_missing";
export type Planned = { write: Write; refusal?: Refusal };

const key = (owner: string, sk: string): Key => ({ pk: ownerPk(owner), sk });

// #region items
/** Only a note carries the two index attributes, so only notes appear in the index. */
export function noteItem(owner: string, note: TaggedNote): Item {
  return {
    ...key(owner, noteSk(note.id)),
    [INDEX_PK]: ownerPk(owner),
    [INDEX_SK]: recentSk(note.updatedAt, note.id),
    ...note,
  };
}

const tagItem = (owner: string, tag: string, note: TaggedNote): Item => ({
  ...key(owner, tagSk(tag, note.id)),
  noteId: note.id,
  title: note.title,
  createdAt: note.createdAt,
});

const slugItem = (owner: string, slug: string, noteId: string): Item => ({
  ...key(owner, slugSk(slug)),
  noteId,
});
// #endregion items

// #region create
export function planCreate(owner: string, note: TaggedNote, maxNotes: number): Planned[] {
  return [
    {
      write: { kind: "put", item: noteItem(owner, note), condition: { kind: "not_exists" } },
      refusal: "already_exists",
    },
    {
      // Counted in the same transaction as the note, so the count cannot drift from the notes.
      write: {
        kind: "update",
        key: key(owner, QUOTA_SK),
        add: { noteCount: 1 },
        condition: { kind: "missing_or_less_than", attribute: "noteCount", value: maxNotes },
      },
      refusal: "quota_exceeded",
    },
    ...(note.slug === undefined
      ? []
      : [
          {
            // DynamoDB has no unique constraint. An item whose key is the slug is one.
            write: {
              kind: "put" as const,
              item: slugItem(owner, note.slug, note.id),
              condition: { kind: "not_exists" as const },
            },
            refusal: "slug_taken" as const,
          },
        ]),
    ...note.tags.map((tag) => ({
      write: { kind: "put" as const, item: tagItem(owner, tag, note) },
    })),
  ];
}
// #endregion create

// #region update
export function planUpdate(owner: string, current: TaggedNote, next: TaggedNote): Planned[] {
  const planned: Planned[] = [
    {
      write: {
        kind: "update",
        key: key(owner, noteSk(current.id)),
        set: {
          title: next.title,
          body: next.body,
          tags: next.tags,
          version: next.version,
          updatedAt: next.updatedAt,
          // Written on every update, so a note from before the index existed enters it here.
          [INDEX_PK]: ownerPk(owner),
          [INDEX_SK]: recentSk(next.updatedAt, next.id),
          ...(next.slug === undefined ? {} : { slug: next.slug }),
        },
        ...(next.slug === undefined && current.slug !== undefined ? { remove: ["slug"] } : {}),
        condition: { kind: "equals", attribute: "version", value: current.version },
      },
      refusal: "stale",
    },
  ];

  for (const tag of current.tags.filter((tag) => !next.tags.includes(tag))) {
    planned.push({ write: { kind: "delete", key: key(owner, tagSk(tag, current.id)) } });
  }
  for (const tag of next.tags) {
    // The title is copied beside each tag: when it changes, every copy is rewritten.
    if (!current.tags.includes(tag) || current.title !== next.title) {
      planned.push({ write: { kind: "put", item: tagItem(owner, tag, next) } });
    }
  }

  if (current.slug !== next.slug) {
    if (current.slug !== undefined) {
      planned.push({ write: { kind: "delete", key: key(owner, slugSk(current.slug)) } });
    }
    if (next.slug !== undefined) {
      planned.push({
        write: {
          kind: "put",
          item: slugItem(owner, next.slug, next.id),
          condition: { kind: "not_exists" },
        },
        refusal: "slug_taken",
      });
    }
  }
  return planned;
}
// #endregion update

// #region remove
export function planRemove(owner: string, current: TaggedNote): Planned[] {
  return [
    {
      write: {
        kind: "delete",
        key: key(owner, noteSk(current.id)),
        // The tags and the slug below are the ones this version has.
        condition: { kind: "equals", attribute: "version", value: current.version },
      },
      refusal: "stale",
    },
    { write: { kind: "update", key: key(owner, QUOTA_SK), add: { noteCount: -1 } } },
    ...current.tags.map((tag) => ({
      write: { kind: "delete" as const, key: key(owner, tagSk(tag, current.id)) },
    })),
    ...(current.slug === undefined
      ? []
      : [{ write: { kind: "delete" as const, key: key(owner, slugSk(current.slug)) } }]),
  ];
}
// #endregion remove

// #region attach
const attachmentKey = (owner: string, layout: Layout, noteId: string, id: string): Key =>
  key(owner, layout === "new" ? attachmentSk(noteId, id) : legacyAttachmentSk(noteId, id));

export function planAttach(owner: string, attachment: Attachment, layouts: Layout[]): Planned[] {
  return [
    {
      // The note is not changed, only required to be there when the attachment is written.
      write: {
        kind: "check",
        key: key(owner, noteSk(attachment.noteId)),
        condition: { kind: "exists" },
      },
      refusal: "note_missing",
    },
    ...layouts.map((layout) => ({
      write: {
        kind: "put" as const,
        item: { ...attachmentKey(owner, layout, attachment.noteId, attachment.id), ...attachment },
        condition: { kind: "not_exists" as const },
      },
      refusal: "already_exists" as const,
    })),
  ];
}

export function planDetach(
  owner: string,
  noteId: string,
  id: string,
  layouts: Layout[],
): Planned[] {
  return layouts.map((layout) => ({
    write: { kind: "delete", key: attachmentKey(owner, layout, noteId, id) },
  }));
}
// #endregion attach
