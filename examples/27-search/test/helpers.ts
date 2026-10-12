import type { Note } from "@aih/example-05-dynamodb/src/contract.ts";
import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";

import type { Embedder } from "../src/embedder.ts";
import { createIndexer } from "../src/indexer.ts";
import { InMemoryVectorIndex } from "../src/memory-vector-index.ts";
import { createSearch } from "../src/search.ts";

const AT = "2026-10-13T00:00:00.000Z";

export const note = (id: string, title: string, body: string, version = 1): Note => ({
  id,
  title,
  body,
  version,
  createdAt: AT,
  updatedAt: AT,
});

/**
 * An embedder a test controls: a text gets the vector of the first concept whose
 * word it contains. Three dimensions are enough to tell three subjects apart.
 */
export function conceptEmbedder(concepts: Record<string, number[]>): Embedder & { calls: number } {
  const embedder = {
    dimensions: 3,
    calls: 0,
    async embed(text: string) {
      embedder.calls += 1;
      const found = Object.entries(concepts).find(([word]) => text.includes(word));
      return found?.[1] ?? [0, 0, 1];
    },
  };
  return embedder;
}

/** Two subjects. "automobile" and "car" share no word and point the same way. */
export const CONCEPTS = {
  car: [1, 0, 0],
  automobile: [1, 0, 0],
  クルマ: [1, 0, 0],
  payment: [0, 1, 0],
  決済: [0, 1, 0],
};

export function world(embedder: Embedder = conceptEmbedder(CONCEPTS)) {
  const notes = new InMemoryNoteRepository();
  const index = new InMemoryVectorIndex(embedder.dimensions);
  const indexer = createIndexer({ embedder, index });
  const search = createSearch({ notes, embedder, index });
  /** Writes a note and indexes it, as the table and the stream would between them. */
  const write = async (owner: string, written: Note) => {
    await notes.create(owner, written);
    await indexer({ owner, noteId: written.id, before: "none", after: written });
  };
  return { notes, index, indexer, search, write, embedder };
}

export async function keysIn(index: InMemoryVectorIndex): Promise<string[]> {
  const keys: string[] = [];
  for await (const entry of index.list()) {
    keys.push(`${entry.key}@${entry.version}`);
  }
  return keys.toSorted();
}
