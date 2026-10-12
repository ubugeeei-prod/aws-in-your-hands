import type { AudioCache } from "../src/audio-cache.ts";
import { cacheKeys } from "../src/cache-key.ts";
import type { Synthesizer } from "../src/synthesizer.ts";
import type { VoiceId } from "../src/voices.ts";

// The cache most people write first. It lives under test/ because it is wrong.

// #region naive
/** Look, synthesize if absent, store. Two callers that look at the same moment both pay. */
export async function readThrough(
  cache: AudioCache,
  synthesize: Synthesizer,
  voice: VoiceId,
  ssml: string,
): Promise<"cache" | "synthesized" | "lost"> {
  const { audio } = cacheKeys(voice, ssml);
  if (await cache.exists(audio)) {
    return "cache";
  }
  const speech = await synthesize({ ssml, voice });
  // A conditional write here keeps the second copy out of the bucket, not off the bill.
  const written = await cache.create(audio, speech.audio, speech.contentType);
  return written.created ? "synthesized" : "lost";
}
// #endregion naive
