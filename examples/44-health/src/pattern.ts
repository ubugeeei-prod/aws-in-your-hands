import type { Pattern } from "./watch.ts";

// #region matcher
/**
 * The part of EventBridge's pattern matching that this chapter's rules use, and nothing else:
 * a field matches when its value is a string equal to one of the listed strings, a nested
 * object is matched field by field, and every field of the pattern must match.
 * No prefix, suffix, anything-but, numeric, exists, wildcard or $or; arrays in the event are
 * not handled either, because none of the matched fields is an array.
 */
export function matches(pattern: Pattern, event: unknown): boolean {
  if (typeof event !== "object" || event === null) {
    return false;
  }
  const record = event as Record<string, unknown>;
  return Object.entries(pattern).every(([field, expected]) => {
    const actual = record[field];
    return Array.isArray(expected)
      ? typeof actual === "string" && expected.includes(actual)
      : matches(expected as Pattern, actual);
  });
}
// #endregion matcher
