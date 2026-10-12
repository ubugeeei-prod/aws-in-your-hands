// #region interface
/** What the index knows about one passage. The text itself is not here: it stays in the table. */
export type VectorEntry = {
  key: string;
  vector: number[];
  owner: string;
  noteId: string;
  /** The note's version when the passage was embedded. */
  version: number;
  passage: number;
};

export type VectorHit = Omit<VectorEntry, "vector"> & {
  /** Cosine distance: 0 for the same direction, 1 for unrelated, 2 for opposite. */
  distance: number;
};

/** S3 Vectors in AWS, a Map on a laptop. */
export type VectorIndex = {
  /** Replaces whatever is stored under the same key. */
  put(entries: VectorEntry[]): Promise<void>;
  delete(keys: string[]): Promise<void>;
  /** The nearest passages among those stored for `owner`. Nearest first. */
  query(query: { vector: number[]; owner: string; topK: number }): Promise<VectorHit[]>;
  /** Everything stored, without the vectors. For reconciling against the table. */
  list(): AsyncIterable<Omit<VectorEntry, "vector">>;
};
// #endregion interface
