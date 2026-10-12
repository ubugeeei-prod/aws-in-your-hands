import type { Ranked } from "./bm25.ts";

// #region rrf
// A BM25 score and a cosine distance have no common scale, so only the positions are
// combined. 60 is this example's choice. It was not tuned.
const RRF_K = 60;

/** Reciprocal rank fusion: each list gives an entry 1 / (60 + its position). */
export function fuse(lists: { name: string; ranked: Ranked[] }[]): (Ranked & { from: string[] })[] {
  const fused = new Map<string, { score: number; from: string[] }>();
  for (const list of lists) {
    list.ranked.forEach((entry, index) => {
      const current = fused.get(entry.id) ?? { score: 0, from: [] };
      current.score += 1 / (RRF_K + index + 1);
      current.from.push(list.name);
      fused.set(entry.id, current);
    });
  }
  return [...fused.entries()]
    .map(([id, entry]) => ({ id, ...entry }))
    .toSorted((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}
// #endregion rrf
