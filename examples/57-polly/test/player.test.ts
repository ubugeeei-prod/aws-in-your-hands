import { describe, expect, it } from "vite-plus/test";

import { playInOrder, requestSpeech, type Sound } from "../src/player.ts";

/** Sounds that end only when the test says so. */
function speakers() {
  const events: string[] = [];
  const listeners = new Map<string, Record<string, () => void>>();
  const create = (url: string): Sound => {
    listeners.set(url, {});
    return {
      play: async () => {
        events.push(`play ${url}`);
      },
      pause: () => {
        events.push(`pause ${url}`);
      },
      addEventListener: (type, listener) => {
        listeners.set(url, { ...listeners.get(url), [type]: listener });
      },
    };
  };
  const fire = (url: string, type: "ended" | "error") => listeners.get(url)?.[type]?.();
  return { create, events, fire };
}

describe("playing the parts", () => {
  it("starts each part only when the one before it has ended", async () => {
    const { create, events, fire } = speakers();
    const { finished } = playInOrder(["a", "b", "c"], create);
    expect(events).toEqual(["play a"]);
    fire("a", "ended");
    expect(events).toEqual(["play a", "play b"]);
    fire("b", "ended");
    fire("c", "ended");
    expect(await finished).toBe("ended");
    expect(events).toEqual(["play a", "play b", "play c"]);
  });

  it("stops the part that is playing and starts no other", async () => {
    const { create, events, fire } = speakers();
    const { finished, stop } = playInOrder(["a", "b"], create);
    stop();
    fire("a", "ended");
    expect(await finished).toBe("stopped");
    expect(events).toEqual(["play a", "pause a"]);
  });

  it("fails when a part cannot be played, such as an expired URL", async () => {
    const { create, fire } = speakers();
    const { finished } = playInOrder(["a", "b"], create);
    fire("a", "error");
    await expect(finished).rejects.toThrow("Part 1 did not play");
  });
});

describe("asking for speech", () => {
  const note = { title: "t", body: "b" };

  it("returns the URLs in order", async () => {
    const result = await requestSpeech(
      async () =>
        Response.json({
          voice: "Kazuha",
          engine: "neural",
          parts: [
            { url: "https://cache.test/1", source: "cache" },
            { url: "https://cache.test/2", source: "synthesized" },
          ],
          billedCharacters: 12,
          expiresInSeconds: 3600,
        }),
      note,
    );
    expect(result).toEqual({ ok: true, urls: ["https://cache.test/1", "https://cache.test/2"] });
  });

  it("tells a retryable refusal from a final one", async () => {
    const refusal = (status: number, retryable?: boolean) => async () =>
      Response.json(
        { error: { code: "busy", message: "Try again.", requestId: "r", retryable } },
        { status },
      );
    expect(await requestSpeech(refusal(503, true), note)).toEqual({
      ok: false,
      retryable: true,
      message: "Try again.",
    });
    expect(await requestSpeech(refusal(400), note)).toMatchObject({ ok: false, retryable: false });
    expect(
      await requestSpeech(
        async () => Response.json({ message: "Forbidden" }, { status: 403 }),
        note,
      ),
    ).toEqual({ ok: false, retryable: false, message: "HTTP 403" });
  });
});
