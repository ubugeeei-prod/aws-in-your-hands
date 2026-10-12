import { describe, expect, it } from "vite-plus/test";

import {
  MAX_PASSAGES_PER_NOTE,
  OVERLAP_CHARS,
  PASSAGE_CHARS,
  passagesOf,
  vectorKey,
  vectorKeys,
} from "../src/chunk.ts";

describe("passagesOf", () => {
  it("never makes more passages than the keys the indexer clears", () => {
    // 10,000 characters is the longest body chapter 05 accepts.
    const passages = passagesOf({ title: "t", body: "あ".repeat(10_000) });
    expect(passages).toHaveLength(MAX_PASSAGES_PER_NOTE);
    expect(passages.map((passage) => passage.index)).toEqual([...Array(15).keys()]);
  });

  it("repeats the end of one passage at the start of the next", () => {
    const body = Array.from({ length: 1_000 }, (_, index) => String(index % 10)).join("");
    const [first, second] = passagesOf({ title: "t", body });
    const tail = first?.text.slice(-OVERLAP_CHARS);
    expect(first?.text).toHaveLength("t\n\n".length + PASSAGE_CHARS);
    expect(second?.text.slice("t\n\n".length).startsWith(tail ?? "x")).toBe(true);
  });

  it("gives a note without a body one passage, so its title can be found", () => {
    expect(passagesOf({ title: "買い物", body: "" })).toEqual([{ index: 0, text: "買い物" }]);
  });

  it("does not cut a character that takes two UTF-16 units", () => {
    const passages = passagesOf({ title: "t", body: "😀".repeat(900) });
    for (const passage of passages) {
      // encodeURIComponent throws on half a surrogate pair.
      expect(() => encodeURIComponent(passage.text)).not.toThrow();
    }
  });

  it("gives the same passages every time", () => {
    const written = { title: "t", body: "x".repeat(2_000) };
    expect(passagesOf(written)).toEqual(passagesOf(written));
  });
});

describe("vector keys", () => {
  it("cannot collide across owners, whatever an owner is called", () => {
    expect(vectorKey("a/b", "n", 0)).toBe("a%2Fb/n/0");
    expect(vectorKey("a", "b/n", 0)).not.toBe(vectorKey("a/b", "n", 0));
  });

  it("lists a half-open range", () => {
    expect(vectorKeys("o", "n", 1, 3)).toEqual(["o/n/1", "o/n/2"]);
    expect(vectorKeys("o", "n", 3, 3)).toEqual([]);
  });
});
