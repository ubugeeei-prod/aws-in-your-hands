import * as v from "valibot";

import { errorBodySchema, type speechRequestSchema, speechResponseSchema } from "./contract.ts";

// #region request
export type Requested =
  | { ok: true; urls: string[] }
  | { ok: false; retryable: boolean; message: string };

/** Asks for the audio of a note. `send` is `fetch`, or a signed version of it. */
export async function requestSpeech(
  send: (body: string) => Promise<Response>,
  note: v.InferInput<typeof speechRequestSchema>,
): Promise<Requested> {
  const response = await send(JSON.stringify(note));
  const body: unknown = await response.json();
  if (!response.ok) {
    const failure = v.safeParse(errorBodySchema, body);
    return failure.success
      ? {
          ok: false,
          retryable: failure.output.error.retryable === true,
          message: failure.output.error.message,
        }
      : { ok: false, retryable: false, message: `HTTP ${response.status}` };
  }
  return { ok: true, urls: v.parse(speechResponseSchema, body).parts.map((part) => part.url) };
}
// #endregion request

// #region play
/** The part of an HTMLAudioElement this file uses. */
export type Sound = {
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: "ended" | "error", listener: () => void): void;
};

/**
 * Plays the parts one after another. Resolves "ended" after the last part, "stopped" if
 * `stop` was called, and rejects if a part cannot be played.
 */
export function playInOrder(
  urls: string[],
  createSound: (url: string) => Sound,
): { finished: Promise<"ended" | "stopped">; stop: () => void } {
  let current: Sound | undefined;
  let stopped = false;
  let settle: (how: "ended" | "stopped") => void = () => undefined;
  const finished = new Promise<"ended" | "stopped">((resolve, reject) => {
    settle = resolve;
    const next = (index: number) => {
      const url = urls[index];
      if (stopped || url === undefined) {
        resolve(stopped ? "stopped" : "ended");
        return;
      }
      current = createSound(url);
      current.addEventListener("ended", () => next(index + 1));
      current.addEventListener("error", () => reject(new Error(`Part ${index + 1} did not play`)));
      current.play().catch(reject);
    };
    next(0);
  });
  return {
    finished,
    stop: () => {
      stopped = true;
      current?.pause();
      settle("stopped");
    },
  };
}
// #endregion play
