import type { VectorEntry, VectorIndex } from "./vector-index.ts";

// #region cosine
/** 1 - cos(a, b). A vector of zeros has no direction, so it is "unrelated" to everything. */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 1 : 1 - dot / Math.sqrt(normA * normB);
}
// #endregion cosine

// #region memory
/**
 * Compares the query with every stored vector. That is exact, where S3 Vectors is
 * approximate: this index never misses a neighbour, the real one may.
 */
export class InMemoryVectorIndex implements VectorIndex {
  readonly #entries = new Map<string, VectorEntry>();
  readonly dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async put(entries: VectorEntry[]) {
    for (const entry of entries) {
      if (entry.vector.length !== this.dimensions) {
        throw new Error(`expected ${this.dimensions} dimensions, got ${entry.vector.length}`);
      }
      this.#entries.set(entry.key, entry);
    }
  }

  async delete(keys: string[]) {
    for (const key of keys) {
      this.#entries.delete(key);
    }
  }

  async query(query: { vector: number[]; owner: string; topK: number }) {
    return (
      [...this.#entries.values()]
        // The filter runs first, as on an S3 Vectors index in ENHANCED mode.
        .filter((entry) => entry.owner === query.owner)
        .map(({ vector, ...rest }) => ({ ...rest, distance: cosineDistance(query.vector, vector) }))
        .toSorted((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : 1))
        .slice(0, query.topK)
    );
  }

  async *list() {
    for (const { vector: _vector, ...rest } of this.#entries.values()) {
      yield rest;
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}
// #endregion memory
