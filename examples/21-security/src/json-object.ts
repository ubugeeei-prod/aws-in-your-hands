import * as v from "valibot";

// #region json-object
/** What JSON calls an object: not null, not an array. v.object and v.record take an array too. */
export const jsonObject = v.custom<Record<string, unknown>>(
  (input) => typeof input === "object" && input !== null && !Array.isArray(input),
  "expected an object, not an array",
);

/**
 * An object as its `[key, value]` pairs, every own key included. v.record leaves out
 * `__proto__`, `prototype`, and `constructor` without an issue, and a policy checker
 * must not skip an entry it was handed: `constructor` is a valid logical ID.
 */
export const jsonEntries = <Value extends v.GenericSchema>(value: Value) =>
  v.pipe(
    jsonObject,
    v.transform((input) => Object.entries(input)),
    v.array(v.tuple([v.string(), value])),
  );
// #endregion json-object
