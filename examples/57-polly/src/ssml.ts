import { MAX_BILLED_CHARACTERS, MAX_TOTAL_CHARACTERS } from "./voices.ts";

// #region escape
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

// The Char production of XML 1.0: tab, LF, CR, and everything from U+0020 up except the
// surrogate block, U+FFFE and U+FFFF. Anything else makes the document invalid, escaped or not.
const writable = (codePoint: number): boolean =>
  codePoint === 0x9 ||
  codePoint === 0xa ||
  codePoint === 0xd ||
  (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
  (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
  codePoint >= 0x10000;

/** User text as SSML character data: it can be spoken, and it cannot become a tag. */
export function escapeSsml(text: string): string {
  let escaped = "";
  // By code point: a whole surrogate pair is one character, half of one is not a character.
  for (const character of text) {
    if (writable(character.codePointAt(0) ?? 0)) {
      escaped += ENTITIES[character] ?? character;
    }
  }
  return escaped;
}
// #endregion escape

// #region measure
const utf8 = new TextEncoder();

/**
 * The size Polly's limit is compared with. The guide says "characters" and not how it counts
 * them, so this counts the escaped text in UTF-8 bytes: no way of counting gives more.
 */
export function billedSize(text: string): number {
  return utf8.encode(escapeSsml(text)).byteLength;
}
// #endregion measure

// #region document
export type Segment = { text: string; pauseAfterMs: number };

/** One request to Polly. The only tags in it are the ones written here. */
export function toSsml(segment: Segment): string {
  if (billedSize(segment.text) > MAX_BILLED_CHARACTERS) {
    throw new Error("A segment is larger than one SynthesizeSpeech request takes.");
  }
  const pause = segment.pauseAfterMs > 0 ? `<break time="${segment.pauseAfterMs}ms"/>` : "";
  const document = `<speak>${escapeSsml(segment.text)}${pause}</speak>`;
  if (utf8.encode(document).byteLength > MAX_TOTAL_CHARACTERS) {
    throw new Error("The SSML document is larger than one SynthesizeSpeech request takes.");
  }
  return document;
}
// #endregion document
