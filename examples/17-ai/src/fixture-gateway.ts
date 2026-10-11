import { z } from "zod";
import type { ModelGateway } from "./summarize.ts";

// #region fixture
const thrownSchema = z.object({ name: z.string(), message: z.string() });

export const fixtureSchema = z.object({
  // Where the shapes come from. These files are written by hand, not recorded.
  source: z.string(),
  description: z.string(),
  // Errors for the first calls to open the stream, one per attempt.
  openErrors: z.array(thrownSchema).default([]),
  // Then the stream: events in order. A `throw` step ends it with an error;
  // running out of steps ends it silently, as a dropped connection would.
  steps: z.array(z.union([z.object({ event: z.unknown() }), z.object({ throw: thrownSchema })])),
});
export type Fixture = z.infer<typeof fixtureSchema>;

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
