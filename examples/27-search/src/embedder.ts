import { tokenize } from "./tokenize.ts";

// #region interface
/** Text in, a vector of `dimensions` numbers out. Amazon Titan in AWS. */
export type Embedder = {
  dimensions: number;
  embed(text: string): Promise<number[]>;
};
// #endregion interface

// #region hashing
// FNV-1a, 32 bits: small, and the same on every machine.
function hash(token: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < token.length; index += 1) {
    value ^= token.charCodeAt(index);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/**
 * A stand-in for an embedding model that needs no model: every token adds 1 or -1 at a
 * position chosen by its hash. Two texts are close when they share tokens. It knows
 * nothing about meaning: "car" and "automobile" are unrelated to it.
 */
export function createHashingEmbedder(dimensions = 256): Embedder {
  return {
    dimensions,
    async embed(text) {
      const vector = Array.from({ length: dimensions }, () => 0);
      for (const token of tokenize(text)) {
        const hashed = hash(token);
        const position = hashed % dimensions;
        vector[position] = (vector[position] ?? 0) + ((hashed >>> 16) % 2 === 0 ? 1 : -1);
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      return norm === 0 ? vector : vector.map((value) => value / norm);
    },
  };
}
// #endregion hashing
