import type { Outcome } from "./interpreter.ts";
import { type LocalWorld, noteKey, text } from "./local-world.ts";
import { attachmentKey, executionName, type ImportInput, REDRIVABLE } from "./saga.ts";

export type Leftover = { note: "absent" | "pending" | "ready"; attachment: boolean };

/** What one import has in the table and the bucket right now. */
export function leftover(world: LocalWorld, input: ImportInput): Leftover {
  const stored = world.items.get(noteKey(input.owner, input.noteId));
  const phase =
    text(stored?.["saga"]) === executionName(input) ? text(stored?.["phase"]) : undefined;
  return {
    note: phase === "ready" ? "ready" : phase === "pending" ? "pending" : "absent",
    attachment: world.objects.has(attachmentKey(input)),
  };
}

// #region invariant
/**
 * An import that has ended left the note ready with its attachment, or left
 * neither. The one exception fails under its own error, in a state a redrive
 * can resume: the step with no way back, or a compensation.
 */
export function violations(world: LocalWorld, input: ImportInput, outcome: Outcome): string[] {
  const left = leftover(world, input);
  const whole = left.note === "ready" && left.attachment;
  const nothing = left.note === "absent" && !left.attachment;
  const found = `found ${left.note} note, ${left.attachment ? "an" : "no"} attachment`;
  if (left.note === "ready" && !left.attachment) {
    return [`a published note without its attachment (${found})`];
  }
  if (outcome.status === "SUCCEEDED") {
    return whole ? [] : [`succeeded, but ${found}`];
  }
  if (outcome.error === "ImportRolledBack" || outcome.error === "NoteIdTaken") {
    return nothing ? [] : [`${outcome.error}, but ${found}`];
  }
  const state = outcome.resume?.state;
  return REDRIVABLE.some((name) => name === state) || nothing
    ? []
    : [`failed with ${outcome.error} outside a state a redrive can finish, and ${found}`];
}
// #endregion invariant
