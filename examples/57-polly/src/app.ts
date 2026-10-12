import * as v from "valibot";

import { readJson } from "@aih/example-04-http-api/src/http/body.ts";
import { type Fetch, route, router } from "@aih/example-04-http-api/src/http/router.ts";
import type { Logger } from "@aih/example-04-http-api/src/log.ts";

import type { AudioCache } from "./audio-cache.ts";
import { type ErrorBody, speechRequestSchema, type SpeechResponse } from "./contract.ts";
import type { Speak } from "./speak.ts";
import { SpeechThrottled } from "./synthesizer.ts";
import { VOICES } from "./voices.ts";

export type AppDeps = {
  stage: string;
  backend: string;
  speak: Speak;
  cache: Pick<AudioCache, "presignView">;
  log: Logger;
  newRequestId: () => string;
  now: () => number;
};

/** How long a URL in the answer can be used. A listener may pause and come back. */
export const VIEW_SECONDS = 3600;
/** Room for the longest note the schema accepts, written as JSON. */
const MAX_BODY_BYTES = 64 * 1024;
const RETRY_AFTER_SECONDS = 5;

type Context = { requestId: string };

const failure = (
  status: number,
  code: ErrorBody["error"]["code"],
  message: string,
  { requestId }: Context,
  retryable?: boolean,
) =>
  Response.json(
    {
      error: { code, message, requestId, ...(retryable === undefined ? {} : { retryable }) },
    } satisfies ErrorBody,
    {
      status,
      headers: retryable === true ? { "retry-after": String(RETRY_AFTER_SECONDS) } : {},
    },
  );

export function createApp(deps: AppDeps): Fetch {
  const routes = router<Context>(
    [
      route("GET", "/health", () =>
        Response.json({ status: "ok", stage: deps.stage, backend: deps.backend }),
      ),
      route("POST", "/speech", async (request, context) => {
        const body = await readJson(request, MAX_BODY_BYTES);
        if (!body.ok) {
          return body.reason === "too_large"
            ? failure(413, "payload_too_large", "The request body exceeds 64 KiB.", context)
            : failure(400, "invalid_request", "The request body is not valid JSON.", context);
        }
        const input = v.safeParse(speechRequestSchema, body.value);
        if (!input.success) {
          return failure(400, "invalid_request", "The note is not valid.", context);
        }
        const { voice, ...note } = input.output;

        // #region route
        const startedAt = deps.now();
        const record = (outcome: string, parts: { billedCharacters: number; source: string }[]) =>
          // Sizes and outcomes only. The text of a note never reaches the log.
          deps.log({
            level: outcome === "ok" ? "info" : "warn",
            message: "speech",
            requestId: context.requestId,
            voice,
            engine: VOICES[voice].engine,
            outcome,
            parts: parts.length,
            synthesized: parts.filter((part) => part.source === "synthesized").length,
            billedCharacters: parts.reduce((sum, part) => sum + part.billedCharacters, 0),
            durationMs: deps.now() - startedAt,
          });

        let result;
        try {
          result = await deps.speak(note, voice);
        } catch (error) {
          if (error instanceof SpeechThrottled) {
            record("throttled", []);
            return failure(429, "throttled", "Too many voices at once. Try again.", context, true);
          }
          throw error;
        }
        if (!result.ok) {
          // Someone else is synthesizing the same text. Their audio will be there on the retry.
          record("busy", result.parts);
          return failure(503, "busy", "This note is being prepared. Try again.", context, true);
        }
        if (result.parts.length === 0) {
          record("nothing_to_read", []);
          return failure(422, "nothing_to_read", "The note has no text to read.", context);
        }
        record("ok", result.parts);
        return Response.json({
          voice,
          engine: VOICES[voice].engine,
          parts: await Promise.all(
            result.parts.map(async (part) => ({
              url: await deps.cache.presignView(part.key, VIEW_SECONDS),
              source: part.source,
            })),
          ),
          billedCharacters: result.parts.reduce((sum, part) => sum + part.billedCharacters, 0),
          expiresInSeconds: VIEW_SECONDS,
        } satisfies SpeechResponse);
        // #endregion route
      }),
    ],
    (_request, context) => failure(404, "not_found", "No such route.", context),
  );

  return async (request) => {
    const context = { requestId: deps.newRequestId() };
    let response: Response;
    try {
      response = await routes(request, context);
    } catch (error) {
      deps.log({
        level: "error",
        message: "unhandled error",
        requestId: context.requestId,
        // The name only: a service error's message can quote the request.
        error: error instanceof Error ? error.name : "unknown",
      });
      response = failure(500, "internal", "The request could not be completed.", context);
    }
    response.headers.set("x-request-id", context.requestId);
    return response;
  };
}
