// A note is searched and cited in passages, not as a whole: an embedding of 10,000
// characters says little about any one of its sentences.

// #region chunk
export const PASSAGE_CHARS = 800;
/** The end of one passage is the start of the next, so a sentence cut by a boundary is whole in one of them. */
export const OVERLAP_CHARS = 100;
/** A body of 10,000 characters (chapter 05's limit) gives 15 passages. Pinned by a test. */
export const MAX_PASSAGES_PER_NOTE = 15;

export type Passage = { index: number; text: string };

/** The same note always gives the same passages. Both the indexer and the search rely on that. */
export function passagesOf(note: { title: string; body: string }): Passage[] {
  // By code point, so a surrogate pair is never cut in half.
  const characters = Array.from(note.body);
  const passages: Passage[] = [];
  const step = PASSAGE_CHARS - OVERLAP_CHARS;
  for (let start = 0; ; start += step) {
    const piece = characters.slice(start, start + PASSAGE_CHARS).join("");
    // The title goes into every passage: it is often the only place the subject is named.
    passages.push({ index: passages.length, text: `${note.title}\n\n${piece}`.trim() });
    if (start + PASSAGE_CHARS >= characters.length) {
      return passages;
    }
  }
}
// #endregion chunk

// #region keys
/** One vector per passage, under a key that can be computed again without looking anything up. */
export function vectorKey(owner: string, noteId: string, index: number): string {
  return `${encodeURIComponent(owner)}/${noteId}/${index}`;
}

export function vectorKeys(owner: string, noteId: string, from: number, to: number): string[] {
  const keys: string[] = [];
  for (let index = from; index < to; index += 1) {
    keys.push(vectorKey(owner, noteId, index));
  }
  return keys;
}
// #endregion keys
