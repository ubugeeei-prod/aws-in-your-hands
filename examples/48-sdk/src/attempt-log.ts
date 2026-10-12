import type { MetadataBearer, Pluggable } from "@smithy/types";
import * as v from "valibot";

import type { Logger } from "@aih/example-05-dynamodb/src/log.ts";
import { requestLineSchema } from "@aih/example-19-observability/src/log-shape.ts";

// #region shape
const { level, requestId, traceId, spanId, sampled } = requestLineSchema.entries;

// Chapter 19's line, with what one attempt of one AWS call adds. Strict for the same reason.
export const attemptLineSchema = v.strictObject({
  level,
  requestId,
  traceId,
  spanId,
  sampled,
  message: v.literal("aws attempt"),
  client: v.string(),
  command: v.string(),
  attempt: v.pipe(v.number(), v.integer(), v.minValue(1)),
  maxAttempts: v.pipe(v.number(), v.integer(), v.minValue(1)),
  // Absent when no answer came back: a refused connection, a timeout, an abort.
  status: v.optional(v.pipe(v.number(), v.integer())),
  awsRequestId: v.optional(v.string()),
  // The error's `name`, never its message: a message can carry a key or an item.
  error: v.optional(v.string()),
  durationMs: v.pipe(v.number(), v.minValue(0)),
});
export type AttemptLine = v.InferOutput<typeof attemptLineSchema>;
// #endregion shape

export type AttemptLogDeps = {
  log: Logger;
  /** The application's request this call belongs to. A client outlives requests, so it is asked each time. */
  requestId: () => string;
  now: () => number;
};

// #region parse
// What the retry middleware wrote on the request it is about to send.
const attemptHeader = /^attempt=(\d+); max=(\d+)$/;

function attemptOf(request: unknown): { attempt: number; maxAttempts: number } {
  const headers =
    typeof request === "object" && request !== null && "headers" in request
      ? (request.headers as Record<string, unknown>)
      : {};
  const header = headers["amz-sdk-request"];
  const match = typeof header === "string" ? attemptHeader.exec(header) : null;
  // A custom retry strategy may not write the header. One attempt is then all that is known.
  return match === null
    ? { attempt: 1, maxAttempts: 1 }
    : { attempt: Number(match[1]), maxAttempts: Number(match[2]) };
}

const metadataSchema = v.object({
  name: v.optional(v.string()),
  $metadata: v.optional(
    v.object({ httpStatusCode: v.optional(v.number()), requestId: v.optional(v.string()) }),
  ),
});

function answerOf(value: unknown): { status?: number; awsRequestId?: string; error?: string } {
  const parsed = v.safeParse(metadataSchema, value);
  const metadata = parsed.success ? parsed.output.$metadata : undefined;
  return {
    ...(metadata?.httpStatusCode === undefined ? {} : { status: metadata.httpStatusCode }),
    ...(metadata?.requestId === undefined ? {} : { awsRequestId: metadata.requestId }),
  };
}
// #endregion parse

// #region plugin
export const ATTEMPT_LOG_MIDDLEWARE = "attemptLogMiddleware";

/**
 * One line per attempt. It sits in `finalizeRequest` below the retry middleware, so the retry
 * loop calls it again for every attempt, and it sees the answer already parsed.
 */
export function attemptLogPlugin<Input extends object, Output extends MetadataBearer>(
  deps: AttemptLogDeps,
): Pluggable<Input, Output> {
  return {
    applyToStack(stack) {
      stack.add(
        (next, context) => async (args) => {
          const startedAt = deps.now();
          const line = (lineLevel: AttemptLine["level"], answer: object) =>
            deps.log({
              level: lineLevel,
              message: "aws attempt",
              requestId: deps.requestId(),
              client: context.clientName ?? "unknown",
              command: context.commandName ?? "unknown",
              ...attemptOf(args.request),
              ...answer,
              durationMs: deps.now() - startedAt,
            });
          try {
            const result = await next(args);
            line("info", answerOf(result.output));
            return result;
          } catch (error) {
            const name = error instanceof Error ? error.name : "unknown";
            line("warn", { ...answerOf(error), error: name });
            throw error;
          }
        },
        // `low` puts it after the retry middleware, which is `high` in the same step, and the signer.
        { step: "finalizeRequest", priority: "low", name: ATTEMPT_LOG_MIDDLEWARE, override: true },
      );
    },
  };
}
// #endregion plugin
