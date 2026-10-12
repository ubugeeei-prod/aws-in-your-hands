import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import type { LogEntry } from "@aih/example-04-http-api/src/log.ts";

import { createApp, VIEW_SECONDS } from "../src/app.ts";
import { errorBodySchema, speechResponseSchema } from "../src/contract.ts";
import { fakeSynthesizer } from "../src/fake-synthesizer.ts";
import { InMemoryAudioCache } from "../src/memory-audio-cache.ts";
import { createSpeaker, type Speak } from "../src/speak.ts";
import { SpeechThrottled, type Synthesizer } from "../src/synthesizer.ts";
import { fakeClock, NOTE } from "./helpers.ts";

function setup(overrides: { speak?: Speak; synthesize?: Synthesizer } = {}) {
  let requestId = 0;
  const logs: LogEntry[] = [];
  const cache = new InMemoryAudioCache("http://cache.test");
  const clock = fakeClock();
  const calls: string[] = [];
  const synthesize: Synthesizer = (input) => {
    calls.push(input.voice);
    return (overrides.synthesize ?? fakeSynthesizer)(input);
  };
  const app = createApp({
    stage: "test",
    backend: "fake",
    cache,
    speak:
      overrides.speak ?? createSpeaker({ cache, synthesize, now: clock.now, sleep: clock.sleep }),
    log: (entry) => logs.push(entry),
    newRequestId: () => `req-${++requestId}`,
    now: clock.now,
  });
  const post = (body: unknown) =>
    app(
      new Request("http://api.test/speech", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  return { app, post, logs, calls, cache };
}

const errorOf = async (response: Response) => v.parse(errorBodySchema, await response.json()).error;

describe("POST /speech", () => {
  it("answers with the parts in reading order, each a URL that expires", async () => {
    const { post, cache } = setup();
    const response = await post(NOTE);
    expect(response.status).toBe(200);
    const speech = v.parse(speechResponseSchema, await response.json());
    expect(speech).toMatchObject({
      voice: "Kazuha",
      engine: "neural",
      expiresInSeconds: VIEW_SECONDS,
    });
    expect(speech.parts.map((part) => part.source)).toEqual(["synthesized", "synthesized"]);
    // The title's audio first, then the body's.
    const [title, body] = speech.parts.map((part) => new URL(part.url).pathname);
    expect(
      cache
        .keys("speech/")
        .map((key) => `/local/audio/${key}`)
        .toSorted(),
    ).toEqual([title, body].toSorted());
    expect(title).not.toBe(body);
  });

  it("bills nothing when the same note is asked for again", async () => {
    const { post, calls } = setup();
    const first = v.parse(speechResponseSchema, await (await post(NOTE)).json());
    const second = v.parse(speechResponseSchema, await (await post(NOTE)).json());
    expect(first.billedCharacters).toBeGreaterThan(0);
    expect(second.billedCharacters).toBe(0);
    expect(second.parts.map((part) => part.source)).toEqual(["cache", "cache"]);
    expect(second.parts.map((part) => part.url)).toEqual(first.parts.map((part) => part.url));
    expect(calls).toHaveLength(2);
  });

  it("lets the caller pick a voice from the list, and never the engine", async () => {
    const { post, calls } = setup();
    const mizuki = await post({ ...NOTE, voice: "Mizuki", engine: "generative" });
    expect(v.parse(speechResponseSchema, await mizuki.json())).toMatchObject({
      voice: "Mizuki",
      engine: "standard",
    });
    expect((await post({ ...NOTE, voice: "Ruth" })).status).toBe(400);
    expect((await post({ ...NOTE, voice: "__proto__" })).status).toBe(400);
    expect(calls).toEqual(["Mizuki", "Mizuki"]);
  });

  it("refuses what is not a note before anything is synthesized", async () => {
    const { post, calls } = setup();
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ title: "t" })).status).toBe(400);
    expect((await post({ title: "t", body: "あ".repeat(10_001) })).status).toBe(400);
    expect((await post({ title: "t".repeat(121), body: "" })).status).toBe(400);
    expect((await post({ title: "t", body: "x".repeat(70_000) })).status).toBe(413);
    const empty = await post({ title: " ", body: "\n" });
    expect(empty.status).toBe(422);
    expect((await errorOf(empty)).code).toBe("nothing_to_read");
    expect(calls).toEqual([]);
  });

  it("says try again when someone else is preparing the same text", async () => {
    const { post } = setup({ speak: async () => ({ ok: false, reason: "busy", parts: [] }) });
    const response = await post(NOTE);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await errorOf(response)).toMatchObject({ code: "busy", retryable: true });
  });

  it("says try again when Polly throttles", async () => {
    const { post } = setup({
      synthesize: async () => {
        throw new SpeechThrottled("Rate exceeded");
      },
    });
    const response = await post(NOTE);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await errorOf(response)).toMatchObject({ code: "throttled", retryable: true });
  });
});

describe("what leaves the app", () => {
  it("logs sizes and outcomes, never the text of the note", async () => {
    const { post, logs } = setup();
    await post(NOTE);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      message: "speech",
      outcome: "ok",
      voice: "Kazuha",
      engine: "neural",
      parts: 2,
      synthesized: 2,
    });
    const line = JSON.stringify(logs);
    expect(line).not.toContain("牛乳");
    expect(line).not.toContain("買い物");
  });

  it("logs the name of an unexpected error, not its message", async () => {
    const { post, logs } = setup({
      synthesize: async () => {
        throw new Error(`Invalid SSML near: ${NOTE.body}`);
      },
    });
    const response = await post(NOTE);
    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(JSON.stringify(logs)).not.toContain("牛乳");
    expect(JSON.stringify(await response.json())).not.toContain("牛乳");
  });

  it("answers 404 for anything else, and GET /health without touching Polly", async () => {
    const { app, calls } = setup();
    expect((await app(new Request("http://api.test/speech"))).status).toBe(404);
    const health = await app(new Request("http://api.test/health"));
    expect(await health.json()).toEqual({ status: "ok", stage: "test", backend: "fake" });
    expect(calls).toEqual([]);
  });
});
