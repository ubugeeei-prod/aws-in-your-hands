import { describe, expect, it } from "vite-plus/test";

import { billedSize, escapeSsml, toSsml } from "../src/ssml.ts";
import { MAX_BILLED_CHARACTERS, MAX_TOTAL_CHARACTERS } from "../src/voices.ts";

/** What is left of a document once the tags this app writes are taken out. */
const userPart = (ssml: string): string =>
  ssml.replace(/^<speak>/, "").replace(/(<break time="\d+ms"\/>)?<\/speak>$/, "");

const HOSTILE = [
  '<break time="10s"/>',
  "</speak><speak>second document",
  '<prosody rate="x-slow">slow</prosody>',
  '<phoneme alphabet="ipa" ph="x">word</phoneme>',
  "<![CDATA[ <break/> ]]>",
  "<!-- comment -->",
  '<?xml version="1.0"?><!DOCTYPE speak [<!ENTITY a "aaaa">]>&a;',
  "&lt;break/&gt;",
  "&#60;break/&#62;",
  'Tom & Jerry said "it\'s < 3 > 2"',
  "＜全角のかっこ＞は そのまま",
];

describe("user text in SSML", () => {
  it("writes the five reserved characters as entities", () => {
    expect(escapeSsml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });

  it("leaves no tag, comment, or entity of the user's in the document", () => {
    for (const text of HOSTILE) {
      const inside = userPart(toSsml({ text, pauseAfterMs: 700 }));
      expect(inside).not.toMatch(/[<>"']/);
      // Every ampersand begins one of the five entities written by escapeSsml.
      expect(inside.replaceAll(/&(amp|lt|gt|quot|apos);/g, "")).not.toContain("&");
    }
  });

  it("escapes text that is already escaped, so it is read as written", () => {
    expect(escapeSsml("&lt;break/&gt;")).toBe("&amp;lt;break/&amp;gt;");
  });

  it("drops characters XML cannot carry, and keeps the ones it can", () => {
    expect(escapeSsml("a\u0000b\u0008c\u000Bd\u001Fe￾f￿")).toBe("abcdef");
    expect(escapeSsml("tab\tline\nreturn\r")).toBe("tab\tline\nreturn\r");
    // Half of a surrogate pair is not a character. A whole pair is.
    expect(escapeSsml("a\uD83Db")).toBe("ab");
    expect(escapeSsml("a\uDE00b")).toBe("ab");
    expect(escapeSsml("a😀b")).toBe("a😀b");
  });

  it("wraps the text in one speak element, with a pause only where asked", () => {
    expect(toSsml({ text: "買い物", pauseAfterMs: 700 })).toBe(
      '<speak>買い物<break time="700ms"/></speak>',
    );
    expect(toSsml({ text: "牛乳を買う。", pauseAfterMs: 0 })).toBe("<speak>牛乳を買う。</speak>");
  });
});

describe("the size of a request", () => {
  it("counts the escaped text in UTF-8 bytes: the largest any count could be", () => {
    expect(billedSize("abc")).toBe(3);
    expect(billedSize("あいう")).toBe(9);
    expect(billedSize("😀")).toBe(4);
    expect(billedSize("&")).toBe(5);
  });

  it("refuses a segment over the limit instead of sending it", () => {
    expect(() =>
      toSsml({ text: "a".repeat(MAX_BILLED_CHARACTERS), pauseAfterMs: 0 }),
    ).not.toThrow();
    expect(() => toSsml({ text: "a".repeat(MAX_BILLED_CHARACTERS + 1), pauseAfterMs: 0 })).toThrow(
      /larger/,
    );
    // 601 ampersands are 3005 bytes once escaped.
    expect(() => toSsml({ text: "&".repeat(601), pauseAfterMs: 0 })).toThrow(/larger/);
  });

  it("stays under the total limit with the tags added", () => {
    const largest = toSsml({ text: "a".repeat(MAX_BILLED_CHARACTERS), pauseAfterMs: 700 });
    expect(new TextEncoder().encode(largest).byteLength).toBeLessThanOrEqual(MAX_TOTAL_CHARACTERS);
  });
});
