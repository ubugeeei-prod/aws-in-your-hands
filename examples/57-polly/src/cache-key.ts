import { createHash } from "node:crypto";

import { OUTPUT_FORMAT, VOICES, type VoiceId } from "./voices.ts";

// #region key
export const AUDIO_PREFIX = "speech/";
export const CLAIM_PREFIX = "claims/";

// Raise it when anything that changes the sound changes without changing the SSML.
const VERSION = 1;

export type CacheKeys = { audio: string; claim: string };

/**
 * Everything that decides the bytes Polly returns, hashed. The same text in another voice is
 * another object. JSON keeps the fields apart, so ("ab", "c") and ("a", "bc") cannot collide.
 */
export function cacheKeys(voice: VoiceId, ssml: string): CacheKeys {
  const hash = createHash("sha256")
    .update(JSON.stringify([VERSION, VOICES[voice].engine, voice, OUTPUT_FORMAT, ssml]))
    .digest("hex");
  return { audio: `${AUDIO_PREFIX}${hash}`, claim: `${CLAIM_PREFIX}${hash}` };
}
// #endregion key
