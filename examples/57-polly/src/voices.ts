// #region voices
// Read from "Available voices" in the Polly developer guide on 2026-10-13. The engine is
// fixed here, on the server: a caller picks a voice, never a price.
export const VOICES = {
  Kazuha: { language: "ja-JP", engine: "neural" },
  Tomoko: { language: "ja-JP", engine: "neural" },
  Takumi: { language: "ja-JP", engine: "neural" },
  Mizuki: { language: "ja-JP", engine: "standard" },
  Joanna: { language: "en-US", engine: "neural" },
} as const satisfies Record<string, { language: string; engine: "neural" | "standard" }>;

export type VoiceId = keyof typeof VOICES;
export const VOICE_IDS = Object.keys(VOICES) as [VoiceId, ...VoiceId[]];
export const DEFAULT_VOICE: VoiceId = "Kazuha";
// #endregion voices

// #region limits
// SynthesizeSpeech takes 3000 billed characters and 6000 in all; tags are not billed.
export const MAX_BILLED_CHARACTERS = 3000;
export const MAX_TOTAL_CHARACTERS = 6000;
// #endregion limits

export const OUTPUT_FORMAT = "mp3";
