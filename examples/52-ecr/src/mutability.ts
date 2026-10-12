import * as v from "valibot";

import { matchesWildcard } from "./wildcard.ts";

// #region setting
export const MUTABILITY = [
  "MUTABLE",
  "IMMUTABLE",
  "IMMUTABLE_WITH_EXCLUSION",
  "MUTABLE_WITH_EXCLUSION",
] as const;

// The API's own pattern and bounds for a WILDCARD filter: at most five per repository.
const exclusionFilter = v.pipe(v.string(), v.regex(/^[0-9a-zA-Z._*-]{1,128}$/));

export const mutabilitySchema = v.pipe(
  v.object({
    mode: v.picklist(MUTABILITY),
    exclusions: v.optional(v.pipe(v.array(exclusionFilter), v.maxLength(5)), []),
  }),
  v.check(
    ({ mode, exclusions }) => mode.endsWith("_WITH_EXCLUSION") === exclusions.length > 0,
    "exclusion filters go with the _WITH_EXCLUSION modes, and those modes need at least one",
  ),
);
export type Mutability = v.InferOutput<typeof mutabilitySchema>;

/** Whether a tag that already exists may be pointed at another image. */
export function tagCanMove(setting: Mutability, tag: string): boolean {
  const excluded = setting.exclusions.some((filter) => matchesWildcard(filter, tag));
  switch (setting.mode) {
    case "MUTABLE":
      return true;
    case "IMMUTABLE":
      return false;
    // The filters name the exceptions to the mode.
    case "IMMUTABLE_WITH_EXCLUSION":
      return excluded;
    case "MUTABLE_WITH_EXCLUSION":
      return !excluded;
  }
}
// #endregion setting
