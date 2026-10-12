import type { Note } from "@aih/example-05-dynamodb/src/contract.ts";
import type { NoteRepository } from "@aih/example-05-dynamodb/src/repository.ts";

import { rankByWords } from "./bm25.ts";
import { passagesOf } from "./chunk.ts";
import type { Embedder } from "./embedder.ts";
import { fuse } from "./fusion.ts";
import type { VectorHit, VectorIndex } from "./vector-index.ts";

export type Way = "words" | "meaning";

export type FoundPassage = {
  noteId: string;
  title: string;
  passage: number;
  /** Always read from the table under the caller's own key. Never from the index. */
  text: string;
  score: number;
  matched: Way[];
};

export type SearchOutcome = {
  passages: FoundPassage[];
  /** "unavailable": the embedding model or the index failed, and the words answered alone. */
  meaning: "used" | "unavailable";
  /** Hits the index gave that were not returned, and why. Logged, never shown. */
  dropped: { foreign: number; stale: number };
};

export type SearchDeps = {
  notes: Pick<NoteRepository, "list">;
  embedder: Embedder;
  index: VectorIndex;
};

export type Search = (owner: string, query: string, limit: number) => Promise<SearchOutcome>;

/** How many neighbours to ask the index for. One page of QueryVectors holds 100. */
export const VECTOR_TOP_K = 30;
/**
 * A nearest-neighbour query always answers with something, however far away. Past this
 * cosine distance a hit is treated as unrelated. 0.7 is a starting value that was not
 * calibrated against Titan: log real distances and move it.
 */
export const MAX_DISTANCE = 0.7;

// Chapter 05 stops an owner at 100 notes. A page is cut at 1 MB, hence the loop.
const READ_PAGE = 100;
const MAX_READ_PAGES = 20;

// #region load
/** Every note of one owner, read with that owner's partition key. */
export async function loadNotes(
  notes: Pick<NoteRepository, "list">,
  owner: string,
): Promise<Note[]> {
  const all: Note[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_READ_PAGES; page += 1) {
    const result = await notes.list(owner, { limit: READ_PAGE, cursor });
    all.push(...result.notes);
    if (result.nextCursor === null) {
      return all;
    }
    cursor = result.nextCursor;
  }
  throw new Error(`owner has more notes than ${MAX_READ_PAGES} pages hold`);
}
// #endregion load

const passageId = (noteId: string, passage: number): string => `${noteId}#${passage}`;

// #region search
export function createSearch(deps: SearchDeps): Search {
  return async (owner, query, limit) => {
    // The table is the truth. Everything that can be returned is in `mine`.
    const mine = new Map<string, { note: Note; text: string; passage: number }>();
    const versions = new Map<string, number>();
    for (const note of await loadNotes(deps.notes, owner)) {
      versions.set(note.id, note.version);
      for (const passage of passagesOf(note)) {
        mine.set(passageId(note.id, passage.index), {
          note,
          text: passage.text,
          passage: passage.index,
        });
      }
    }

    const byWords = rankByWords(
      query,
      [...mine.entries()].map(([id, entry]) => ({ id, text: entry.text })),
    );

    let hits: VectorHit[] = [];
    let meaning: SearchOutcome["meaning"] = "used";
    try {
      hits = await deps.index.query({
        vector: await deps.embedder.embed(query),
        owner,
        topK: VECTOR_TOP_K,
      });
    } catch {
      // Half an answer beats none: the word search needs neither Bedrock nor the index.
      meaning = "unavailable";
    }

    // The index is a hint. A hit counts only if the table agrees with it.
    const dropped = { foreign: 0, stale: 0 };
    const byMeaning = hits.flatMap((hit) => {
      if (hit.owner !== owner) {
        dropped.foreign += 1;
        return [];
      }
      if (hit.distance > MAX_DISTANCE) {
        return [];
      }
      const id = passageId(hit.noteId, hit.passage);
      // Deleted, edited since it was embedded, or never this owner's: not in the table as the index says.
      if (versions.get(hit.noteId) !== hit.version || !mine.has(id)) {
        dropped.stale += 1;
        return [];
      }
      return [{ id, score: 1 - hit.distance }];
    });

    const passages = fuse([
      { name: "words", ranked: byWords },
      { name: "meaning", ranked: byMeaning },
    ])
      .slice(0, limit)
      .flatMap((entry) => {
        const found = mine.get(entry.id);
        return found === undefined
          ? []
          : [
              {
                noteId: found.note.id,
                title: found.note.title,
                passage: found.passage,
                text: found.text,
                score: entry.score,
                matched: entry.from.filter(
                  (way): way is Way => way === "words" || way === "meaning",
                ),
              },
            ];
      });
    return { passages, meaning, dropped };
  };
}
// #endregion search
