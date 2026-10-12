import { randomUUID } from "node:crypto";

import { INDEX, INDEX_PK, INDEX_PROJECTION, INDEX_SK } from "../src/keys.ts";
import { MemoryTable } from "../src/memory-table.ts";
import type { Attachment, TaggedNote } from "../src/model.ts";

export const memoryTable = (): MemoryTable =>
  new MemoryTable({ name: INDEX, pk: INDEX_PK, sk: INDEX_SK, include: INDEX_PROJECTION });

/** A fresh owner per test, so tests can share one table. */
export const freshOwner = (): string => `test-${randomUUID()}`;

export const at = (minute: number): string =>
  new Date(Date.UTC(2026, 9, 13, 0, minute)).toISOString();

export const note = (id: string, overrides: Partial<TaggedNote> = {}): TaggedNote => ({
  id,
  title: `note ${id}`,
  body: "",
  version: 1,
  createdAt: at(0),
  updatedAt: at(0),
  tags: [],
  ...overrides,
});

export const attachment = (noteId: string, id: string): Attachment => ({
  id,
  noteId,
  contentType: "image/png",
  size: 1024,
  createdAt: at(1),
});

export const change = (
  expectedVersion: number,
  overrides: Partial<{
    title: string;
    body: string;
    tags: string[];
    slug: string;
    minute: number;
  }> = {},
) => ({
  title: overrides.title ?? "changed",
  body: overrides.body ?? "new body",
  tags: overrides.tags ?? [],
  ...(overrides.slug === undefined ? {} : { slug: overrides.slug }),
  expectedVersion,
  updatedAt: at(overrides.minute ?? 30),
});

/** A global secondary index follows its table a moment later. On the memory table this returns at once. */
export async function eventually<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 40 && !done(value); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}
