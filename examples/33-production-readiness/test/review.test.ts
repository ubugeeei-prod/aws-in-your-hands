import { describe, expect, it } from "vite-plus/test";

import config from "../../../vite.config.ts";
import { AREAS, REVIEW } from "../src/review.ts";
import { RULE_IDS } from "../src/rules/rule.ts";

const tasks = new Set(
  Object.keys((config as { run?: { tasks?: Record<string, unknown> } }).run?.tasks ?? {}),
);

describe("the review", () => {
  it("gives every item its own name inside a known area", () => {
    const ids = REVIEW.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of REVIEW) {
      expect(item.id.startsWith(`${item.area}.`)).toBe(true);
    }
    expect([...new Set(REVIEW.map((item) => item.area))]).toEqual([...AREAS]);
  });

  it("says for every item what goes wrong, which chapter does the work, and what to ask", () => {
    for (const item of REVIEW) {
      expect(item.without.length, item.id).toBeGreaterThan(20);
      expect(item.ask.endsWith("?"), item.id).toBe(true);
      expect(item.chapters.length, item.id).toBeGreaterThan(0);
      for (const chapter of item.chapters) {
        expect(chapter, item.id).toMatch(/^(0\d|[12]\d|3[0-6])$/);
        expect(chapter, item.id).not.toBe("33");
      }
    }
  });

  it("places every rule of the template check under an item", () => {
    const placed = new Set(REVIEW.flatMap((item) => item.rules));
    expect(RULE_IDS.filter((rule) => !placed.has(rule))).toEqual([]);
  });

  it("names only tasks that exist", () => {
    expect(tasks.size).toBeGreaterThan(100);
    const missing = REVIEW.flatMap((item) => item.tasks).filter((task) => !tasks.has(task));
    expect(missing).toEqual([]);
  });
});
