import type { DescribeDeps } from "../src/describe.ts";
import { SAMPLE_PNG } from "../src/fixtures.ts";
import { mediaKeys } from "../src/media.ts";
import { MemoryMedia } from "../src/memory-media.ts";
import { createScriptedModel, type Script } from "../src/scripted-model.ts";

export const ALICE = { owner: "alice", noteId: "note-1", attachmentId: "image-1" };
export const START = Date.parse("2026-10-13T00:00:00.000Z");

/** Lets every promise that can move, move. The scripted model and the Map need no real time. */
export const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * A job with nothing left to chance: a clock that moves only when told, and a model that
 * answers only when `answer()` is called (with `hold`), so two runs can be interleaved by hand.
 */
export function setup(script: Script, options: { hold?: boolean } = {}) {
  const media = new MemoryMedia();
  media.seed(mediaKeys(ALICE).source, SAMPLE_PNG, "image/png");
  let nowMs = START;
  let claims = 0;
  const held: (() => void)[] = [];
  const deadline = new AbortController();
  const model = createScriptedModel(
    script,
    options.hold === true ? () => new Promise<void>((resolve) => held.push(resolve)) : undefined,
  );
  const deps: DescribeDeps = {
    media,
    model,
    modelId: "jp.amazon.nova-2-lite-v1:0",
    maxOutputTokens: 300,
    language: "ja",
    leaseMs: 60_000,
    timeoutMs: 30_000,
    locate: (key) => ({ uri: `s3://media-bucket/${key}` }),
    now: () => new Date(nowMs),
    newClaimId: () => `claim-${(claims += 1)}`,
    timeoutSignal: () => deadline.signal,
  };
  return {
    media,
    model,
    deps,
    advance: (ms: number) => {
      nowMs += ms;
    },
    /** Lets the oldest waiting model call answer. */
    answer: async () => {
      held.shift()?.();
      await settle();
    },
    expire: () => deadline.abort(new DOMException("timed out", "TimeoutError")),
  };
}
