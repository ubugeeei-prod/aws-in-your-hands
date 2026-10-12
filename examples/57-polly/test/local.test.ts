import { describe, expect, it } from "vite-plus/test";

import { parseEnv } from "../src/env.ts";
import { fakeSynthesizer, tone } from "../src/fake-synthesizer.ts";

describe("the environment", () => {
  it("has no default backend: spending money is chosen", () => {
    expect(() => parseEnv({})).toThrow(/Invalid environment/);
    expect(parseEnv({ SPEECH_BACKEND: "fake" })).toMatchObject({
      SPEECH_BACKEND: "fake",
      AWS_REGION: "ap-northeast-1",
    });
  });

  it("needs a bucket before it will call Polly", () => {
    expect(() => parseEnv({ SPEECH_BACKEND: "polly" })).toThrow(/SPEECH_BUCKET/);
    expect(parseEnv({ SPEECH_BACKEND: "polly", SPEECH_BUCKET: "my-cache" })).toMatchObject({
      SPEECH_BUCKET: "my-cache",
    });
  });
});

describe("the stand-in for the voice", () => {
  it("is a WAV file a browser can play: a header, then 16-bit samples", () => {
    const wav = Buffer.from(tone(0.5));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 16)).toBe("WAVEfmt ");
    expect(wav.readUInt32LE(4)).toBe(wav.byteLength - 8);
    expect(wav.readUInt32LE(40)).toBe(wav.byteLength - 44);
    // Half a second at 8000 samples a second, two bytes each.
    expect(wav.byteLength).toBe(44 + 4000 * 2);
  });

  it("sounds longer for a longer text, and counts only what is between the tags", async () => {
    const short = await fakeSynthesizer({ ssml: "<speak>あ</speak>", voice: "Kazuha" });
    const long = await fakeSynthesizer({
      ssml: '<speak>あいうえお<break time="700ms"/></speak>',
      voice: "Kazuha",
    });
    expect(short).toMatchObject({ contentType: "audio/wav", characters: 1 });
    expect(long.characters).toBe(5);
    expect(long.audio.byteLength).toBeGreaterThan(short.audio.byteLength);
  });
});
