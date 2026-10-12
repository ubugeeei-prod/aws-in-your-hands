import { billedSize, type Segment } from "./ssml.ts";
import { MAX_BILLED_CHARACTERS } from "./voices.ts";

// #region sentences
// A sentence ends after 。！？ or a line break, and after . ! ? when a space follows ("3.14" is
// not two sentences). Splitting between characters loses none: the pieces join back to the text.
const AFTER_SENTENCE = /(?<=[。！？\n])|(?<=[.!?])(?=\s)/u;
// Where to cut a sentence that is too long by itself: after a comma or a space.
const AFTER_CLAUSE = /(?<=[、，,\s])/u;
// #endregion sentences

// #region pack
/** Puts pieces together, in order, into strings no larger than `max`. */
function pack(parts: string[], max: number, split: (part: string) => string[]): string[] {
  const packed: string[] = [];
  let current = "";
  for (const part of parts) {
    if (billedSize(current + part) <= max) {
      current += part;
      continue;
    }
    if (current !== "") {
      packed.push(current);
    }
    if (billedSize(part) <= max) {
      current = part;
    } else {
      // Too large alone: cut it more finely, and let the last piece take what follows.
      const finer = split(part);
      current = finer.pop() ?? "";
      packed.push(...finer);
    }
  }
  return current === "" ? packed : [...packed, current];
}

/** By code point, so a surrogate pair is never cut in half. */
const byCharacter = (text: string, max: number): string[] => pack([...text], max, (c) => [c]);

/** Text as pieces Polly accepts one at a time, cut at sentence ends where it can be. */
export function chunkText(text: string, max: number = MAX_BILLED_CHARACTERS): string[] {
  return pack(text.split(AFTER_SENTENCE), max, (sentence) =>
    pack(sentence.split(AFTER_CLAUSE), max, (clause) => byCharacter(clause, max)),
  );
}
// #endregion pack

// #region segments
export const PAUSE_AFTER_TITLE_MS = 700;

const spoken = (text: string): string[] => chunkText(text).filter((chunk) => chunk.trim() !== "");

/** What is read, in order: the title, a pause, then the body. */
export function segmentsOf(note: { title: string; body: string }): Segment[] {
  return [
    ...spoken(note.title).map((text) => ({ text, pauseAfterMs: PAUSE_AFTER_TITLE_MS })),
    ...spoken(note.body).map((text) => ({ text, pauseAfterMs: 0 })),
  ];
}
// #endregion segments
