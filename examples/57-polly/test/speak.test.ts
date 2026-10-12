import { describe, expect, it } from "vite-plus/test";

import { cacheKeys } from "../src/cache-key.ts";
import { InMemoryAudioCache } from "../src/memory-audio-cache.ts";
import { CLAIM_MS, createSpeaker, WAIT_MS } from "../src/speak.ts";
import { toSsml } from "../src/ssml.ts";
import { fakeClock, gatedSynthesizer, NOTE, settle } from "./helpers.ts";
import { readThrough } from "./naive.ts";

const ONE = { title: "", body: "牛乳を買う。" };
const SSML = toSsml({ text: ONE.body, pauseAfterMs: 0 });
const KEYS = cacheKeys("Kazuha", SSML);
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function setup() {
  const cache = new InMemoryAudioCache("http://cache.test");
  const clock = fakeClock();
  const polly = gatedSynthesizer();
  const speak = createSpeaker({
    cache,
    synthesize: polly.synthesize,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { cache, clock, polly, speak };
}

describe("a cache that looks before it synthesizes", () => {
  // #region broken
  it("pays twice when two requests for the same text arrive together", async () => {
    const { cache, polly } = setup();
    const both = [
      readThrough(cache, polly.synthesize, "Kazuha", SSML),
      readThrough(cache, polly.synthesize, "Kazuha", SSML),
    ];
    // Both have looked, both found nothing, both are now waiting for Polly.
    await settle();
    expect(polly.calls).toHaveLength(2);
    polly.release();
    // The conditional write on the audio keeps one copy. The second bill is already owed.
    expect((await Promise.all(both)).toSorted()).toEqual(["lost", "synthesized"]);
  });
  // #endregion broken
});

describe("one synthesis per distinct input", () => {
  // #region concurrent
  it("pays once when two requests for the same text arrive together", async () => {
    const { polly, speak } = setup();
    const both = [speak(ONE, "Kazuha"), speak(ONE, "Kazuha")];
    await settle();
    // One holds the claim and is waiting for Polly. The other is waiting for the audio.
    expect(polly.calls).toHaveLength(1);
    polly.release();

    const [first, second] = await Promise.all(both);
    expect(polly.calls).toHaveLength(1);
    expect(first).toEqual({
      ok: true,
      parts: [{ key: KEYS.audio, billedCharacters: 6, source: "synthesized" }],
    });
    expect(second).toEqual({
      ok: true,
      parts: [{ key: KEYS.audio, billedCharacters: 0, source: "waited" }],
    });
  });
  // #endregion concurrent

  it("pays once when ten arrive together", async () => {
    const { polly, speak } = setup();
    const all = Array.from({ length: 10 }, () => speak(ONE, "Kazuha"));
    await settle();
    polly.release();
    const results = await Promise.all(all);
    expect(polly.calls).toHaveLength(1);
    expect(results.every((result) => result.ok && result.parts[0]?.key === KEYS.audio)).toBe(true);
  });

  it("pays nothing the second time", async () => {
    const { polly, speak } = setup();
    const first = speak(ONE, "Kazuha");
    await settle();
    polly.release();
    await first;

    expect(await speak(ONE, "Kazuha")).toEqual({
      ok: true,
      parts: [{ key: KEYS.audio, billedCharacters: 0, source: "cache" }],
    });
    expect(polly.calls).toHaveLength(1);
  });

  it("pays again for another voice, and only for the part of a note that changed", async () => {
    const { polly, speak } = setup();
    const run = async (note: typeof NOTE, voice: "Kazuha" | "Tomoko") => {
      const pending = speak(note, voice);
      for (let i = 0; i < 4; i += 1) {
        await settle();
        polly.release();
      }
      return pending;
    };
    await run(NOTE, "Kazuha");
    expect(polly.calls).toHaveLength(2);

    const edited = await run({ ...NOTE, body: `${NOTE.body}パンも買う。` }, "Kazuha");
    expect(edited.ok && edited.parts.map((part) => part.source)).toEqual(["cache", "synthesized"]);
    expect(polly.calls).toHaveLength(3);

    await run(NOTE, "Tomoko");
    expect(polly.calls).toHaveLength(5);
  });
});

describe("a holder that fails", () => {
  it("hands the claim back, so the next request does not wait", async () => {
    const { clock, polly, speak } = setup();
    polly.failNext();
    const failed = speak(ONE, "Kazuha");
    await settle();
    polly.release();
    await expect(failed).rejects.toThrow("synthesis failed");

    const before = clock.now();
    const retry = speak(ONE, "Kazuha");
    await settle();
    polly.release();
    expect(await retry).toMatchObject({ ok: true, parts: [{ source: "synthesized" }] });
    // No sleeping happened: the claim was free.
    expect(clock.now()).toBe(before);
    expect(polly.calls).toHaveLength(2);
  });

  it("keeps the parts that were finished before the failure", async () => {
    const { polly, speak } = setup();
    const first = speak(NOTE, "Kazuha");
    await settle();
    polly.release();
    await settle();
    polly.failNext();
    polly.release();
    await expect(first).rejects.toThrow("synthesis failed");

    const retry = speak(NOTE, "Kazuha");
    await settle();
    polly.release();
    const result = await retry;
    expect(result.ok && result.parts.map((part) => part.source)).toEqual(["cache", "synthesized"]);
    // Title once, body twice: the title was not paid for again.
    expect(polly.calls).toHaveLength(3);
  });
});

describe("a holder that disappears", () => {
  // What a function leaves behind when it is stopped between the claim and the audio.
  const abandon = async ({ cache, clock }: ReturnType<typeof setup>) => {
    await cache.create(KEYS.claim, encode({ claimedAt: clock.now() }), "application/json");
  };

  it("makes others wait, then answer busy, while the claim is young", async () => {
    const context = setup();
    await abandon(context);
    const started = context.clock.now();
    expect(await context.speak(ONE, "Kazuha")).toEqual({ ok: false, reason: "busy", parts: [] });
    expect(context.clock.now() - started).toBeGreaterThanOrEqual(WAIT_MS);
    expect(context.polly.calls).toHaveLength(0);
  });

  // #region takeover
  it("is replaced by exactly one of the requests that find its claim too old", async () => {
    const context = setup();
    await abandon(context);
    context.clock.advance(CLAIM_MS + 1);

    const both = [context.speak(ONE, "Kazuha"), context.speak(ONE, "Kazuha")];
    await settle();
    // Both read the same old claim. The If-Match write let one of them replace it.
    expect(context.polly.calls).toHaveLength(1);
    context.polly.release();
    const sources = (await Promise.all(both)).map((result) => result.ok && result.parts[0]?.source);
    expect(sources.toSorted()).toEqual(["synthesized", "waited"]);
  });
  // #endregion takeover

  it("treats a claim it cannot read as abandoned", async () => {
    const context = setup();
    for (const body of ["not json", '{"claimedAt":"yesterday"}', "[]", "null"]) {
      context.cache.remove(KEYS.claim);
      context.cache.remove(KEYS.audio);
      await context.cache.create(KEYS.claim, new TextEncoder().encode(body), "application/json");
      const pending = context.speak(ONE, "Kazuha");
      await settle();
      context.polly.release();
      expect(await pending).toMatchObject({ ok: true, parts: [{ source: "synthesized" }] });
    }
  });

  it("starts over when the lifecycle rule removes the claim while it waits", async () => {
    const context = setup();
    await abandon(context);
    const pending = context.speak(ONE, "Kazuha");
    await settle(3);
    context.cache.remove(KEYS.claim);
    await settle();
    context.polly.release();
    expect(await pending).toMatchObject({ ok: true, parts: [{ source: "synthesized" }] });
    expect(context.polly.calls).toHaveLength(1);
  });
});

describe("what is stored", () => {
  it("is the audio under speech/ and a small claim under claims/, nothing else", async () => {
    const { cache, polly, speak } = setup();
    const pending = speak(ONE, "Kazuha");
    await settle();
    polly.release();
    await pending;
    expect(cache.keys("")).toEqual([KEYS.claim, KEYS.audio]);
    expect(cache.get(KEYS.audio)?.contentType).toBe("audio/mpeg");
    expect(new TextDecoder().decode(cache.get(KEYS.claim)?.body)).toMatch(/^\{"claimedAt":\d+\}$/);
  });
});
