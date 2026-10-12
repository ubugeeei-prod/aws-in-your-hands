import { describe, expect, it } from "vite-plus/test";

import { cacheKeys } from "../src/cache-key.ts";

const SSML = "<speak>牛乳を買う。</speak>";

describe("cache keys", () => {
  it("gives the same text in the same voice the same object", () => {
    expect(cacheKeys("Kazuha", SSML)).toEqual(cacheKeys("Kazuha", SSML));
  });

  it("gives another voice, another engine, or another text another object", () => {
    const keys = [
      cacheKeys("Kazuha", SSML),
      cacheKeys("Tomoko", SSML),
      // Takumi is neural here and Mizuki standard: the engine is part of the key too.
      cacheKeys("Takumi", SSML),
      cacheKeys("Mizuki", SSML),
      cacheKeys("Kazuha", "<speak>牛乳を買う。 </speak>"),
      cacheKeys("Kazuha", '<speak>牛乳を買う。<break time="700ms"/></speak>'),
    ].map((key) => key.audio);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("puts the audio and its claim under different prefixes with the same name", () => {
    const { audio, claim } = cacheKeys("Kazuha", SSML);
    expect(audio).toMatch(/^speech\/[0-9a-f]{64}$/);
    expect(claim).toBe(audio.replace("speech/", "claims/"));
  });

  it("carries none of the note's text in the key", () => {
    const { audio } = cacheKeys("Joanna", "<speak>secret-plan</speak>");
    expect(audio).not.toContain("secret");
    expect(audio).not.toContain("Joanna");
  });
});
