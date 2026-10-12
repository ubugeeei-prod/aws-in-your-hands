import * as v from "valibot";

import type { ModelGateway } from "./summarize.ts";

// #region fixture
const thrownSchema = v.object({ name: v.string(), message: v.string() });

export const fixtureSchema = v.object({
  // Where the shapes come from. These files are written by hand, not recorded.
  source: v.string(),
  description: v.string(),
  // Errors for the first calls to open the stream, one per attempt.
  openErrors: v.optional(v.array(thrownSchema), []),
  // Then the stream: events in order. A `throw` step ends it with an error;
  // running out of steps ends it silently, as a dropped connection would.
  steps: v.array(v.union([v.object({ event: v.unknown() }), v.object({ throw: thrownSchema })])),
});
export type Fixture = v.InferOutput<typeof fixtureSchema>;

function toError(thrown: { name: string; message: string }): Error {
  const error = new Error(thrown.message);
  error.name = thrown.name;
  return error;
}

/** Replays a fixture as if it were the model. `pause` runs before each step. */
export function createFixtureGateway(
  fixture: Fixture,
  pause: (signal: AbortSignal) => Promise<void> = () => Promise.resolve(),
): ModelGateway & { calls: number } {
  // Counts the failed opens of the request in progress. A stream that opens starts the next one.
  let failedOpens = 0;
  const gateway = {
    calls: 0,
    converseStream(_request: unknown, signal: AbortSignal): Promise<AsyncIterable<unknown>> {
      gateway.calls += 1;
      const openError = fixture.openErrors[failedOpens];
      if (openError !== undefined) {
        failedOpens += 1;
        return Promise.reject(toError(openError));
      }
      failedOpens = 0;
      async function* replay() {
        for (const step of fixture.steps) {
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
  return gateway;
}
// #endregion fixture
