import * as v from "valibot";

import { noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { InMemoryNoteRepository } from "@aih/example-05-dynamodb/src/memory-repository.ts";

import fixture from "../fixtures/notes.json" with { type: "json" };

const fixtureSchema = v.object({
  source: v.string(),
  owners: v.record(v.string(), v.array(noteSchema)),
});

/** Two owners' notes in memory: the local server's data, and the tests'. */
export async function seededNotes(): Promise<InMemoryNoteRepository> {
  const notes = new InMemoryNoteRepository();
  for (const [owner, list] of Object.entries(v.parse(fixtureSchema, fixture).owners)) {
    for (const note of list) {
      await notes.create(owner, note);
    }
  }
  return notes;
}
