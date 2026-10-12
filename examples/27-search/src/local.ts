import * as v from "valibot";

import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";
import { createFixtureGateway, fixtureSchema } from "@aih/example-17-ai/src/fixture-gateway.ts";

import answer from "../fixtures/answer.json" with { type: "json" };
import seed from "../fixtures/notes.json" with { type: "json" };
import type { Parts } from "./compose.ts";
import { createHashingEmbedder } from "./embedder.ts";
import { createIndexer } from "./indexer.ts";
import { InMemoryVectorIndex } from "./memory-vector-index.ts";

const seedSchema = v.object({
  notes: v.array(
    v.object({ owner: v.string(), id: v.string(), title: v.string(), body: v.string() }),
  ),
});

export const answerFixture = v.parse(fixtureSchema, answer);

// #region local
/**
 * Everything in one process, filled with the seed notes. The indexer is called
 * directly after each write here: there is no stream on a laptop.
 */
export async function localParts(pause?: (signal: AbortSignal) => Promise<void>) {
  const notes = new InMemoryNoteRepository();
  const embedder = createHashingEmbedder();
  const index = new InMemoryVectorIndex(embedder.dimensions);
  const indexer = createIndexer({ embedder, index });
  for (const { owner, id, title, body } of v.parse(seedSchema, seed).notes) {
    const at = "2026-10-13T00:00:00.000Z";
    await notes.create(owner, { id, title, body, version: 1, createdAt: at, updatedAt: at });
    await indexer({ owner, noteId: id, before: "none", after: { title, body, version: 1 } });
  }
  const parts: Parts = {
    notes,
    embedder,
    index,
    // Replays one canned answer whatever the question is.
    gateway: createFixtureGateway(answerFixture, pause),
    modelId: "fixture",
  };
  return { ...parts, notes, index, indexer };
}
// #endregion local
