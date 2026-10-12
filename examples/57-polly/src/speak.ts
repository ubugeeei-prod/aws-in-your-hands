import * as v from "valibot";

import type { AudioCache } from "./audio-cache.ts";
import { cacheKeys } from "./cache-key.ts";
import { segmentsOf } from "./chunk.ts";
import { toSsml } from "./ssml.ts";
import type { Synthesizer } from "./synthesizer.ts";
import type { VoiceId } from "./voices.ts";

// #region claim
/** How long a claim is left alone. Longer than the function may run, so its holder is gone by then. */
export const CLAIM_MS = 90_000;
/** How long a caller waits for someone else's synthesis before it answers "try again". */
export const WAIT_MS = 20_000;
export const POLL_MS = 500;

const claimSchema = v.object({ claimedAt: v.pipe(v.number(), v.finite()) });
const JSON_TYPE = "application/json";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const claimBody = (claimedAt: number): Uint8Array => encoder.encode(JSON.stringify({ claimedAt }));
// A claim nobody holds: older than any clock, so the next caller takes it over at once.
const RELEASED = claimBody(0);

/** A claim that cannot be read counts as abandoned. */
function claimedAt(body: Uint8Array): number {
  try {
    const claim = v.safeParse(claimSchema, JSON.parse(decoder.decode(body)));
    return claim.success ? claim.output.claimedAt : 0;
  } catch {
    return 0;
  }
}
// #endregion claim

export type SpeakDeps = {
  cache: AudioCache;
  synthesize: Synthesizer;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export type Part = {
  key: string;
  /** Characters billed by this request: 0 when the audio was already there. */
  billedCharacters: number;
  source: "cache" | "synthesized" | "waited";
};
export type SpeakResult =
  | { ok: true; parts: Part[] }
  | { ok: false; reason: "busy"; parts: Part[] };

export type Speak = (note: { title: string; body: string }, voice: VoiceId) => Promise<SpeakResult>;

export function createSpeaker(deps: SpeakDeps): Speak {
  const { cache } = deps;

  // #region ensure
  /** Makes sure the audio for one SSML document exists, paying Polly at most once for it. */
  async function ensure(voice: VoiceId, ssml: string): Promise<Part | "busy"> {
    const keys = cacheKeys(voice, ssml);
    if (await cache.exists(keys.audio)) {
      return { key: keys.audio, billedCharacters: 0, source: "cache" };
    }

    // The claim is the conditional write: of two callers, S3 lets one create it.
    let held: string | undefined;
    const first = await cache.create(keys.claim, claimBody(deps.now()), JSON_TYPE);
    if (first.created) {
      held = first.etag;
    }
    const deadline = deps.now() + WAIT_MS;
    while (held === undefined) {
      if (await cache.exists(keys.audio)) {
        return { key: keys.audio, billedCharacters: 0, source: "waited" };
      }
      const claim = await cache.read(keys.claim);
      if (claim === undefined) {
        // The claim expired with the lifecycle rule, and the audio with it. Start over.
        const again = await cache.create(keys.claim, claimBody(deps.now()), JSON_TYPE);
        held = again.created ? again.etag : undefined;
      } else if (deps.now() - claimedAt(claim.body) > CLAIM_MS) {
        // Its holder failed or was stopped. Only one of the callers that see this takes over.
        const taken = await cache.replace(keys.claim, claim.etag, claimBody(deps.now()), JSON_TYPE);
        held = taken.replaced ? taken.etag : undefined;
      } else if (deps.now() >= deadline) {
        return "busy";
      } else {
        await deps.sleep(POLL_MS);
      }
    }

    try {
      const speech = await deps.synthesize({ ssml, voice });
      await cache.create(keys.audio, speech.audio, speech.contentType);
      return { key: keys.audio, billedCharacters: speech.characters, source: "synthesized" };
    } catch (error) {
      // Hand the claim back, so the next caller does not wait out CLAIM_MS for nothing.
      await cache.replace(keys.claim, held, RELEASED, JSON_TYPE).catch(() => undefined);
      throw error;
    }
  }
  // #endregion ensure

  // #region speak
  return async (note, voice) => {
    const parts: Part[] = [];
    // One after another: a long note is not a burst against Polly's requests-per-second quota,
    // and whatever is finished stays in the cache if a later part fails.
    for (const segment of segmentsOf(note)) {
      const part = await ensure(voice, toSsml(segment));
      if (part === "busy") {
        return { ok: false, reason: "busy", parts };
      }
      parts.push(part);
    }
    return { ok: true, parts };
  };
  // #endregion speak
}
