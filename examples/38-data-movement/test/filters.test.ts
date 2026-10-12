import { describe, expect, it } from "vite-plus/test";

import {
  filterMatches,
  includePatternProblem,
  patternMatches,
  splitFilter,
} from "../src/filters.ts";

describe("filter strings", () => {
  it("splits on pipes, and keeps an escaped pipe inside its pattern", () => {
    expect(splitFilter("/u/alice|*.tmp")).toEqual(["/u/alice", "*.tmp"]);
    expect(splitFilter(String.raw`/a\|b|/c`)).toEqual([String.raw`/a\|b`, "/c"]);
    expect(splitFilter(undefined)).toEqual([]);
  });

  it("is case sensitive", () => {
    expect(patternMatches("/u/Alice", "u/alice/n1/a1")).toBe(false);
  });
});

describe("patterns against object keys", () => {
  it("selects everything under a folder it names, with or without the trailing slash", () => {
    expect(patternMatches("/u/alice", "u/alice/n1/a1")).toBe(true);
    expect(patternMatches("/u/alice/", "u/alice/n1/a1")).toBe(true);
    expect(patternMatches("/u/alice", "u/alice2/n1/a1")).toBe(false);
  });

  it("anchors a pattern that starts with a slash at the location's root", () => {
    expect(patternMatches("/alice", "u/alice/n1/a1")).toBe(false);
  });

  it("lets a wildcard cross folders", () => {
    expect(patternMatches("*.tmp", "u/alice/n1/draft.tmp")).toBe(true);
    expect(patternMatches("*/n1", "u/alice/n1/a1")).toBe(true);
    expect(patternMatches("/u/al*", "u/alice/n1/a1")).toBe(true);
    expect(patternMatches("*.tmp", "u/alice/n1/draft.tmp.png")).toBe(false);
  });

  it("treats an escaped wildcard as a character of the name", () => {
    expect(patternMatches(String.raw`/u/a\*`, "u/a*")).toBe(true);
    expect(patternMatches(String.raw`/u/a\*`, "u/ab")).toBe(false);
  });

  it("matches a filter when any of its patterns does", () => {
    expect(filterMatches("/u/alice|/u/bob", "u/bob/n1/a1")).toBe(true);
    expect(filterMatches("/u/alice|/u/bob", "u/carol/n1/a1")).toBe(false);
    expect(filterMatches(undefined, "u/carol/n1/a1")).toBe(false);
  });
});

describe("include patterns", () => {
  it("refuses a wildcard anywhere but the end", () => {
    expect(includePatternProblem("/u/alice*")).toBeUndefined();
    expect(includePatternProblem("/u/alice/*")).toBeUndefined();
    expect(includePatternProblem("*.png")).toMatch(/wildcard/);
    expect(includePatternProblem("/u/*/n1")).toMatch(/wildcard/);
  });
});
