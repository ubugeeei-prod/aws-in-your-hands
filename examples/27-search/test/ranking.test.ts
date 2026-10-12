import { describe, expect, it } from "vite-plus/test";

import { rankByWords } from "../src/bm25.ts";
import { createHashingEmbedder } from "../src/embedder.ts";
import { fuse } from "../src/fusion.ts";
import { cosineDistance } from "../src/memory-vector-index.ts";
import { tokenize } from "../src/tokenize.ts";

describe("tokenize", () => {
  it("splits spaced text into lowercased words", () => {
    expect(tokenize("Vector Search, in 2026!")).toEqual(["vector", "search", "in", "2026"]);
  });

  it("cuts Japanese into overlapping pairs, since nothing marks a word's end", () => {
    expect(tokenize("負荷試験")).toEqual(["負荷", "荷試", "試験"]);
    expect(tokenize("犬")).toEqual(["犬"]);
  });

  it("folds full-width and half-width forms before comparing", () => {
    expect(tokenize("ＡＷＳ")).toEqual(["aws"]);
    expect(tokenize("ｶﾀｶﾅ")).toEqual(tokenize("カタカナ"));
  });
});

describe("rankByWords", () => {
  const documents = [
    { id: "a", text: "決済の結合テストと負荷試験" },
    { id: "b", text: "決済のタイムアウト" },
    { id: "c", text: "牛乳と卵" },
  ];

  it("returns only texts that share a token with the query", () => {
    expect(rankByWords("負荷試験", documents).map((entry) => entry.id)).toEqual(["a"]);
    expect(rankByWords("vector", documents)).toEqual([]);
  });

  it("counts a rare word for more than a common one", () => {
    // 決済 is in two texts, タイムアウト in one.
    const ranked = rankByWords("決済 タイムアウト", documents);
    expect(ranked.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("prefers the shorter of two texts that say the word once", () => {
    const ranked = rankByWords("search", [
      { id: "long", text: `search ${"filler ".repeat(50)}` },
      { id: "short", text: "search engine" },
    ]);
    expect(ranked.map((entry) => entry.id)).toEqual(["short", "long"]);
  });

  it("breaks ties by id, so the order never depends on insertion", () => {
    const same = [
      { id: "y", text: "卵" },
      { id: "x", text: "卵" },
    ];
    expect(rankByWords("卵", same).map((entry) => entry.id)).toEqual(["x", "y"]);
  });
});

describe("fuse", () => {
  it("puts an entry both lists found above one that leads a single list", () => {
    const fused = fuse([
      {
        name: "words",
        ranked: [
          { id: "w", score: 9 },
          { id: "both", score: 1 },
        ],
      },
      {
        name: "meaning",
        ranked: [
          { id: "m", score: 0.9 },
          { id: "both", score: 0.1 },
        ],
      },
    ]);
    expect(fused.map((entry) => entry.id)).toEqual(["both", "m", "w"]);
    expect(fused[0]?.from).toEqual(["words", "meaning"]);
    // 1 / (60 + 2), twice.
    expect(fused[0]?.score).toBeCloseTo(2 / 62);
  });
});

describe("the hashing embedder", () => {
  const embedder = createHashingEmbedder();

  it("is the same on every run and has unit length", async () => {
    const first = await embedder.embed("決済の負荷試験");
    expect(await embedder.embed("決済の負荷試験")).toEqual(first);
    expect(Math.hypot(...first)).toBeCloseTo(1);
    expect(first).toHaveLength(256);
  });

  it("measures shared tokens, not meaning", async () => {
    const car = await embedder.embed("car");
    expect(cosineDistance(car, await embedder.embed("car car"))).toBeCloseTo(0);
    // A real embedding model puts these two close together. This one cannot.
    expect(cosineDistance(car, await embedder.embed("automobile"))).toBeGreaterThan(0.9);
  });

  it("treats a text without tokens as unrelated to everything", async () => {
    expect(cosineDistance(await embedder.embed("!?"), await embedder.embed("car"))).toBe(1);
  });
});
