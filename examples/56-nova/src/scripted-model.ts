import * as v from "valibot";

import type { ConverseRequest } from "./image.ts";
import type { ModelGateway } from "./model.ts";

// #region script
const thrownSchema = v.object({ name: v.string(), message: v.string() });

export const scriptSchema = v.object({
  // Where the shapes come from. These files are written by hand, not recorded.
  source: v.string(),
  description: v.string(),
  // One step per call, in order. The last step answers every call after it.
  steps: v.pipe(
    v.array(v.union([v.object({ response: v.unknown() }), v.object({ throw: thrownSchema })])),
    v.minLength(1),
  ),
});
export type Script = v.InferOutput<typeof scriptSchema>;

/** Plays a script as if it were the model. `pause` runs before each answer. */
export function createScriptedModel(
  script: Script,
  pause: (signal: AbortSignal) => Promise<void> = () => Promise.resolve(),
): ModelGateway & { requests: ConverseRequest[] } {
  const requests: ConverseRequest[] = [];
  return {
    requests,
    async converse(request, signal) {
      const step = script.steps[Math.min(requests.length, script.steps.length - 1)];
      requests.push(request);
      await pause(signal);
      // The real client fails the same way once its request is aborted.
      signal.throwIfAborted();
      if (step === undefined || "throw" in step) {
        const error = new Error(step?.throw.message ?? "the script is empty");
        error.name = step?.throw.name ?? "Error";
        throw error;
      }
      return step.response;
    },
  };
}
// #endregion script
