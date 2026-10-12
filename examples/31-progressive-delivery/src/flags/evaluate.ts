import { createHash } from "node:crypto";

import * as v from "valibot";

// #region flags
const percent = v.pipe(v.number(), v.minValue(0), v.maxValue(100));

/**
 * The flags this build reads, with what each one is when the configuration does not say.
 * A flag that is missing takes its default, and a flag this build does not know is ignored:
 * the configuration and the code are deployed apart, so each must tolerate the other's age.
 */
const flagEntries = v.object({
  // Off by default: when nobody can say whether writes should stop, they continue.
  readOnly: v.optional(v.object({ enabled: v.boolean() }), { enabled: false }),
  // Off by default: a feature nobody has released stays unreleased.
  noteStats: v.optional(
    v.object({ enabled: v.boolean(), rolloutPercent: v.optional(percent, 100) }),
    { enabled: false },
  ),
});
export type Flags = v.InferOutput<typeof flagEntries>;

// v.object takes an array, and here every key is optional: `[]` would pass as "all defaults".
export const flagsSchema = v.pipe(
  v.custom<Record<string, unknown>>(
    (input) => typeof input === "object" && input !== null && !Array.isArray(input),
    "Must be an object.",
  ),
  flagEntries,
);

export const knownFlags = Object.keys(flagEntries.entries);

/** What every flag is when nothing at all could be read. */
export const defaultFlags: Flags = v.parse(flagEntries, {});
// #endregion flags

// #region bucket
/**
 * A number from 0 to 9999 that is always the same for the same flag and subject.
 * The flag name is part of the hash, so the first 10% of one flag are not the first 10% of every flag.
 */
export function bucket(flag: string, subject: string): number {
  const digest = createHash("sha256").update(`${flag}:${subject}`).digest();
  return digest.readUInt32BE(0) % 10_000;
}

/** Whether `subject` is inside the first `rolloutPercent` of the buckets. No subject means no. */
export function inRollout(flag: string, rolloutPercent: number, subject: string | undefined) {
  if (rolloutPercent >= 100) {
    return true;
  }
  return subject !== undefined && bucket(flag, subject) < rolloutPercent * 100;
}
// #endregion bucket

// #region decisions
export const writesAreStopped = (flags: Flags) => flags.readOnly.enabled;

export const seesNoteStats = (flags: Flags, subject: string | undefined) =>
  flags.noteStats.enabled && inRollout("noteStats", flags.noteStats.rolloutPercent, subject);
// #endregion decisions
