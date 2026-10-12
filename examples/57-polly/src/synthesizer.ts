import type { VoiceId } from "./voices.ts";

// #region port
export type Synthesized = {
  audio: Uint8Array;
  contentType: string;
  /** What Polly says it billed, from the x-amzn-RequestCharacters header. */
  characters: number;
};

/** Turns one SSML document into audio. Polly in AWS; a tone generator on a laptop. */
export type Synthesizer = (input: { ssml: string; voice: VoiceId }) => Promise<Synthesized>;
// #endregion port

/** Polly refused for now: the requests-per-second quota of the engine was reached. */
export class SpeechThrottled extends Error {
  override readonly name = "SpeechThrottled";
}
