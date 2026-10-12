import type { ConverseRequest } from "@aih/example-36-bedrock/src/converse.ts";
import type { ModelGateway } from "@aih/example-36-bedrock/src/gateway.ts";
import {
  createScriptedModel,
  type Transcript,
} from "@aih/example-36-bedrock/src/scripted-model.ts";

// #region replaying
/** True when the request ends in words from a person, not in the results of tools. */
const opensQuestion = (request: ConverseRequest): boolean => {
  const last = request.messages.at(-1);
  return last?.role === "user" && last.content.every((block) => "text" in block);
};

/**
 * Chapter 36's scripted model plays one transcript for one question. A session asks several,
 * so this starts the next transcript whenever a new question arrives (the last one repeats).
 * It keeps every request it was sent. It does not read them to decide what to say.
 */
export function replayingModel(
  transcripts: readonly [Transcript, ...Transcript[]],
  pause?: (signal: AbortSignal) => Promise<void>,
): ModelGateway & { requests: ConverseRequest[] } {
  const requests: ConverseRequest[] = [];
  let next = 0;
  let playing: ModelGateway | undefined;
  return {
    requests,
    converseStream(request, signal) {
      requests.push(structuredClone(request));
      if (playing === undefined || opensQuestion(request)) {
        const transcript = transcripts[Math.min(next, transcripts.length - 1)] ?? transcripts[0];
        next += 1;
        playing = createScriptedModel(transcript, pause);
      }
      return playing.converseStream(request, signal);
    },
  };
}
// #endregion replaying
