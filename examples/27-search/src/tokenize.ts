// What "a word" is for the word search. No dictionary, no stemming, no stop words:
// "notes" and "note" are different words here, and so are 走る and 走った.

// #region tokenize
const RUNS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+|[\p{L}\p{N}]+/gu;
const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/u;

/**
 * Lowercased words for text written with spaces, overlapping pairs of characters for
 * Japanese and Chinese, where nothing marks where a word ends.
 */
export function tokenize(text: string): string[] {
  // NFKC folds full-width "ＡＷＳ" and half-width "ｶﾀｶﾅ" into the usual forms.
  const normalized = text.normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  for (const [run] of normalized.matchAll(RUNS)) {
    if (!CJK.test(run)) {
      tokens.push(run);
      continue;
    }
    const characters = Array.from(run);
    if (characters.length === 1) {
      tokens.push(run);
    }
    for (let index = 0; index + 1 < characters.length; index += 1) {
      tokens.push(`${characters[index]}${characters[index + 1]}`);
    }
  }
  return tokens;
}
// #endregion tokenize
