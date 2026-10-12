// #region wildcard
/** `*` stands for any run of characters, including none: `prod*` matches `prod`. Nothing else is special. */
export function matchesWildcard(pattern: string, tag: string): boolean {
  const [head = "", ...rest] = pattern.split("*");
  if (rest.length === 0) {
    return pattern === tag;
  }
  if (!tag.startsWith(head)) {
    return false;
  }
  const tail = rest.pop() ?? "";
  let at = head.length;
  for (const part of rest) {
    const found = tag.indexOf(part, at);
    if (found === -1) {
      return false;
    }
    at = found + part.length;
  }
  return tag.length - tail.length >= at && tag.endsWith(tail);
}
// #endregion wildcard

export const wildcardCount = (pattern: string): number => pattern.split("*").length - 1;
