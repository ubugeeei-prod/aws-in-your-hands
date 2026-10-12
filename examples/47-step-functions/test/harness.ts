import type { Outcome } from "../src/interpreter.ts";
import { LocalWorld } from "../src/local-world.ts";
import type { ImportInput } from "../src/saga.ts";

export const INPUT: ImportInput = {
  owner: "user-1",
  noteId: "note-1",
  title: "Minutes",
  body: "What was said",
  upload: "inbox/user-1/minutes.pdf",
};

/** A world in which the upload is waiting in the inbox. */
export function setup(): LocalWorld {
  const world = new LocalWorld();
  world.objects.set(INPUT.upload, "the uploaded bytes");
  return world;
}

/** The states an execution went through, a failed attempt marked with its error. */
export const path = (outcome: Outcome): string[] =>
  outcome.steps.map((step) =>
    step.error === undefined ? step.state : `${step.state}!${step.error}`,
  );
