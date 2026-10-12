import { tokenize } from "./tokenize.ts";

export type Ranked = { id: string; score: number };

// #region bm25
// The usual constants: k1 bounds how much a repeated word keeps adding, b is how
// strongly a long text is discounted.
const K1 = 1.2;
const B = 0.75;

/**
 * Okapi BM25 over the texts it is given, and nothing else: the statistics (how rare a
 * word is, how long a text usually is) come from this one caller's notes.
 */
export function rankByWords(query: string, documents: { id: string; text: string }[]): Ranked[] {
  const terms = [...new Set(tokenize(query))];
  const tokenized = documents.map((document) => ({
    id: document.id,
    tokens: tokenize(document.text),
  }));
  const averageLength =
    tokenized.reduce((sum, document) => sum + document.tokens.length, 0) /
    Math.max(1, tokenized.length);

  const containing = new Map<string, number>();
  for (const term of terms) {
    containing.set(term, tokenized.filter((document) => document.tokens.includes(term)).length);
  }

  const ranked: Ranked[] = [];
  for (const document of tokenized) {
    let score = 0;
    for (const term of terms) {
      const frequency = document.tokens.filter((token) => token === term).length;
      if (frequency === 0) {
        continue;
      }
      const inDocuments = containing.get(term) ?? 0;
      // Never negative, even for a word that is in every text.
      const rarity = Math.log(1 + (tokenized.length - inDocuments + 0.5) / (inDocuments + 0.5));
      const length = document.tokens.length / Math.max(1, averageLength);
      score += (rarity * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * length));
    }
    if (score > 0) {
      ranked.push({ id: document.id, score });
    }
  }
  // Ties in a fixed order, so the same query always answers the same way.
  return ranked.toSorted((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
}
// #endregion bm25
