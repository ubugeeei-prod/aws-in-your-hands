import * as v from "valibot";

import type { ConverseRequest } from "./converse.ts";
import type { ModelGateway } from "./gateway.ts";

// #region transcript
const thrownSchema = v.object({ name: v.string(), message: v.string() });

export const transcriptSchema = v.object({
  // Where the shapes come from. These files are written by hand, not recorded.
  source: v.string(),
  description: v.string(),
  // One entry per call to the model, in the order the calls are made.
  calls: v.array(
    v.union([
      // The call is refused before any event.
      v.object({ openError: thrownSchema }),
      // The stream: events in order. A `throw` step ends it with an error. Running out of
      // steps ends it silently, as a dropped connection would.
      v.object({
        steps: v.array(
          v.union([v.object({ event: v.unknown() }), v.object({ throw: thrownSchema })]),
        ),
      }),
    ]),
  ),
});
export type Transcript = v.InferOutput<typeof transcriptSchema>;
// #endregion transcript

function toError(thrown: { name: string; message: string }): Error {
  const error = new Error(thrown.message);
  error.name = thrown.name;
  return error;
}

// #region scripted
/**
 * Plays a transcript as if it were the model: the first call gets the first entry, the
 * second call the second. It does not read the request to decide what to say. It keeps
 * every request, so a test can see what the loop sent.
 */
export function createScriptedModel(
  transcript: Transcript,
  pause: (signal: AbortSignal) => Promise<void> = () => Promise.resolve(),
): ModelGateway & { requests: ConverseRequest[] } {
  const requests: ConverseRequest[] = [];
  return {
    requests,
    converseStream(request, signal) {
      // A copy: the loop goes on adding to the same array of messages.
      requests.push(structuredClone(request));
      const call = transcript.calls[requests.length - 1];
      if (call === undefined) {
        return Promise.reject(
          new Error(`the transcript has ${transcript.calls.length} calls, and one more was made`),
        );
      }
      if ("openError" in call) {
        return Promise.reject(toError(call.openError));
      }
      const { steps } = call;
      async function* replay() {
        for (const step of steps) {
          await pause(signal);
          // The real client fails the same way once its request is aborted.
          signal.throwIfAborted();
          if ("throw" in step) {
            throw toError(step.throw);
          }
          yield step.event;
        }
      }
      return Promise.resolve(replay());
    },
  };
}
// #endregion scripted
