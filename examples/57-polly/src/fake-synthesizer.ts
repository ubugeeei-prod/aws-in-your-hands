import type { Synthesizer } from "./synthesizer.ts";

// #region tone
const SAMPLE_RATE = 8000;
// A made-up reading speed, only so that a longer text gives a longer sound.
const SECONDS_PER_CHARACTER = 0.01;

/** A WAV file holding a 440 Hz tone: 16-bit mono PCM behind the 44-byte header. */
export function tone(seconds: number): Uint8Array {
  const samples = Math.max(1, Math.round(seconds * SAMPLE_RATE));
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples * 2, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    wav.writeInt16LE(
      Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE)),
      44 + i * 2,
    );
  }
  return new Uint8Array(wav);
}
// #endregion tone

// #region fake
/** No speech: a tone as long as the text is. It says nothing about how Polly sounds or counts. */
export const fakeSynthesizer: Synthesizer = async ({ ssml }) => {
  // What is between the tags, in code points. This file's count, not Polly's.
  const characters = [...ssml.replaceAll(/<[^>]*>/g, "")].length;
  return {
    audio: tone(characters * SECONDS_PER_CHARACTER),
    contentType: "audio/wav",
    characters,
  };
};
// #endregion fake
