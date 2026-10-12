// A model of DataSync's include and exclude filters, written from the user
// guide's "filtering" page. It is this chapter's reading of that page, not DataSync.

// #region split
/** "a|b" is two patterns. "\|" is a pipe inside a name, and "\\" a backslash. */
export function splitFilter(filter: string | undefined): string[] {
  if (filter === undefined || filter === "") {
    return [];
  }
  const patterns: string[] = [];
  let current = "";
  for (let index = 0; index < filter.length; index++) {
    const char = filter.charAt(index);
    if (char === "\\" && index + 1 < filter.length) {
      current += char + filter.charAt(index + 1);
      index++;
    } else if (char === "|") {
      patterns.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  patterns.push(current);
  return patterns.filter((pattern) => pattern !== "");
}
// #endregion split

type Token = { wildcard: true } | { wildcard: false; char: string };

function tokens(pattern: string): Token[] {
  const result: Token[] = [];
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern.charAt(index);
    if (char === "\\") {
      const next = pattern.charAt(index + 1);
      // A backslash before anything but *, | or \ is ignored, and so is one at the end.
      if (next === "*" || next === "|" || next === "\\") {
        result.push({ wildcard: false, char: next });
        index++;
      }
    } else if (char === "*") {
      result.push({ wildcard: true });
    } else {
      result.push({ wildcard: false, char });
    }
  }
  return result;
}

/** Include filters take the wildcard only as the last character of a pattern. */
export function includePatternProblem(pattern: string): string | undefined {
  const parsed = tokens(pattern);
  const misplaced = parsed.slice(0, -1).some((token) => token.wildcard);
  return misplaced
    ? `include pattern "${pattern}" has a wildcard that is not its last character`
    : undefined;
}

function globMatches(pattern: Token[], text: string): boolean {
  // The wildcard crosses "/": the guide's `*/folder` matches a folder at any depth.
  let reachable = new Set<number>([0]);
  for (const token of pattern) {
    const next = new Set<number>();
    for (const position of reachable) {
      if (token.wildcard) {
        for (let end = position; end <= text.length; end++) {
          next.add(end);
        }
      } else if (text.charAt(position) === token.char && position < text.length) {
        next.add(position + 1);
      }
    }
    reachable = next;
  }
  return reachable.has(text.length);
}

// #region matches
/**
 * Whether one pattern selects an object. Patterns are relative to the
 * location's path, "/" in a key is a folder, and a pattern that names a folder
 * selects everything under it.
 */
export function patternMatches(pattern: string, key: string): boolean {
  const trimmed = pattern.length > 1 && pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  const parsed = tokens(trimmed);
  const segments = key.split("/");
  // "/u/a/b" is tried as "/u", "/u/a", then "/u/a/b".
  return segments.some((_, index) =>
    globMatches(parsed, `/${segments.slice(0, index + 1).join("/")}`),
  );
}

export function filterMatches(filter: string | undefined, key: string): boolean {
  return splitFilter(filter).some((pattern) => patternMatches(pattern, key));
}
// #endregion matches
