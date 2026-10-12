import { isThrottlingError, isTransientError } from "@smithy/core/retry";
import type { SdkError } from "@smithy/types";
import * as v from "valibot";

// #region classify
export type CallFailure =
  // The caller gave up: an AbortSignal fired. Nothing is known about what the service did.
  | { kind: "aborted" }
  // The service refused for now. The same request may pass later.
  | { kind: "throttled"; attempts: number }
  // No usable answer: a 5xx, a timeout, a connection that failed.
  | { kind: "unavailable"; attempts: number }
  // The service understood and said no. Sending it again changes nothing.
  | { kind: "rejected"; name: string; status: number | undefined }
  // Not an error the SDK raised for a call.
  | { kind: "unknown" };

const sdkErrorSchema = v.object({
  name: v.string(),
  $fault: v.optional(v.picklist(["client", "server"])),
  $metadata: v.optional(
    v.object({ httpStatusCode: v.optional(v.number()), attempts: v.optional(v.number()) }),
  ),
});

/**
 * Sorts a thrown value by what the caller can do about it. It reads `name`, `$fault` and
 * `$metadata`, and asks the SDK the two questions its retry middleware asked. It never reads
 * `message`.
 */
export function classify(error: unknown): CallFailure {
  const parsed = v.safeParse(sdkErrorSchema, error);
  if (!(error instanceof Error) || !parsed.success) {
    return { kind: "unknown" };
  }
  const { name, $fault, $metadata } = parsed.output;
  // `SdkError` declares `cause` as an Error where `Error` has `unknown`. The two functions
  // below only read fields, and read them defensively.
  const sdkError = error as SdkError;
  const attempts = $metadata?.attempts ?? 1;
  if (name === "AbortError") {
    return { kind: "aborted" };
  }
  if (isThrottlingError(sdkError)) {
    return { kind: "throttled", attempts };
  }
  if (isTransientError(sdkError) || $fault === "server") {
    return { kind: "unavailable", attempts };
  }
  if ($fault === "client") {
    return { kind: "rejected", name, status: $metadata?.httpStatusCode };
  }
  return { kind: "unknown" };
}
// #endregion classify

// #region answer
/** What an HTTP API says to its own caller. A refusal the caller can wait out is not a 500. */
export function toResponse(failure: CallFailure): Response {
  switch (failure.kind) {
    case "throttled":
    case "unavailable":
      return Response.json(
        { error: "try_again_later" },
        { status: 503, headers: { "retry-after": "1" } },
      );
    case "aborted":
    case "rejected":
    case "unknown":
      return Response.json({ error: "internal_error" }, { status: 500 });
  }
}
// #endregion answer
