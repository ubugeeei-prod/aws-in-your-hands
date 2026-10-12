import { describe, expect, it } from "vite-plus/test";

import { chunkText, PAUSE_AFTER_TITLE_MS, segmentsOf } from "../src/chunk.ts";
import { billedSize, toSsml } from "../src/ssml.ts";
import { MAX_BILLED_CHARACTERS } from "../src/voices.ts";

const TEXTS = [
  "牛乳を買う。卵も買う！パンは？ いらない。",
  "First sentence. Second one! A third? Yes.",
  "Pi is 3.14 and e is 2.71. Version 1.2.3 shipped.",
  "一行目\n二行目\n\n段落が変わる。",
  "句点のない長い文、読点はある、だからここで切れる、はず",
  "nospacesnopunctuationjustonelongwordthatgoesonandon",
  "絵文字😀が👨‍👩‍👧入る。&と<と>も入る。",
  "   ",
  "",
];

describe("chunking", () => {
  it("loses nothing: the chunks join back to the text", () => {
    for (const text of TEXTS) {
      for (const max of [8, 20, 60, MAX_BILLED_CHARACTERS]) {
        expect(chunkText(text, max).join("")).toBe(text);
      }
    }
  });

  it("keeps every chunk within the limit, counted the way the request is", () => {
    for (const text of [...TEXTS, "&".repeat(500), "あ".repeat(500)]) {
      for (const max of [8, 20, 60]) {
        for (const chunk of chunkText(text, max)) {
          expect(billedSize(chunk)).toBeLessThanOrEqual(max);
        }
      }
    }
  });

  it("cuts at the end of a sentence when sentences fit", () => {
    // Each sentence is 6 bytes. Two fit in 12, the third starts a new chunk.
    expect(chunkText("一。二。三。", 12)).toEqual(["一。二。", "三。"]);
    expect(chunkText("One. Two. Three.", 10)).toEqual(["One. Two.", " Three."]);
    expect(chunkText("一行目\n二行目\n", 10)).toEqual(["一行目\n", "二行目\n"]);
  });

  it("does not take a decimal point for the end of a sentence", () => {
    expect(chunkText("Pi is 3.14 today. Fine.", 18)).toEqual(["Pi is 3.14 today.", " Fine."]);
  });

  it("cuts a sentence that is too long at a comma, and only then inside a word", () => {
    expect(chunkText("あい、うえ、おか。", 12)).toEqual(["あい、", "うえ、", "おか。"]);
    expect(chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("never cuts a surrogate pair in half", () => {
    for (const chunk of chunkText("😀😀😀😀😀", 6)) {
      expect(chunk).toBe("😀");
    }
  });
});

describe("the segments of a note", () => {
  it("reads the title, pauses, then reads the body", () => {
    expect(segmentsOf({ title: "買い物", body: "牛乳を買う。" })).toEqual([
      { text: "買い物", pauseAfterMs: PAUSE_AFTER_TITLE_MS },
      { text: "牛乳を買う。", pauseAfterMs: 0 },
    ]);
  });

  it("has nothing to read in a note of spaces and line breaks", () => {
    expect(segmentsOf({ title: "  ", body: "\n\n \t" })).toEqual([]);
    expect(segmentsOf({ title: "題だけ", body: "" })).toHaveLength(1);
  });

  it("turns the longest note the API accepts into requests Polly accepts", () => {
    // 10,000 characters of three bytes each: 30,000 bytes, ten requests.
    const japanese = segmentsOf({ title: "長いノート", body: "あ".repeat(10_000) });
    expect(japanese).toHaveLength(11);
    // The worst case for escaping: every character becomes five.
    const ampersands = segmentsOf({ title: "&".repeat(120), body: "&".repeat(10_000) });
    for (const segment of [...japanese, ...ampersands]) {
      expect(() => toSsml(segment)).not.toThrow();
    }
  });
});
