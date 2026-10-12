import { type PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";

import { SpeechThrottled, type Synthesizer } from "./synthesizer.ts";
import { OUTPUT_FORMAT, VOICES } from "./voices.ts";

// #region polly
export function createPollySynthesizer(client: PollyClient): Synthesizer {
  return async ({ ssml, voice }) => {
    let response;
    try {
      response = await client.send(
        new SynthesizeSpeechCommand({
          Engine: VOICES[voice].engine,
          VoiceId: voice,
          OutputFormat: OUTPUT_FORMAT,
          TextType: "ssml",
          Text: ssml,
        }),
      );
    } catch (error) {
      // The SDK has already retried. What is left is for the caller to try later.
      if (isThrottle(error)) {
        throw new SpeechThrottled("Polly throttled the request", { cause: error });
      }
      throw error;
    }
    if (response.AudioStream === undefined) {
      throw new Error("SynthesizeSpeech returned no audio");
    }
    return {
      // The whole of it in memory: a request is at most 3000 characters of speech.
      audio: await response.AudioStream.transformToByteArray(),
      contentType: response.ContentType ?? "audio/mpeg",
      characters: response.RequestCharacters ?? 0,
    };
  };
}
// #endregion polly

/** What the SDK marks as a throttle, whatever the service names it. */
function isThrottle(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "$retryable" in error &&
    typeof error.$retryable === "object" &&
    error.$retryable !== null &&
    "throttling" in error.$retryable &&
    error.$retryable.throttling === true
  );
}
