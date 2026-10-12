import * as v from "valibot";

import { MAX_QUESTION_CHARS } from "@aih/example-36-bedrock/src/contract.ts";

// #region headers
/** The header AgentCore Runtime routes a session by, and repeats to the agent. */
export const SESSION_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id";
// #endregion headers

// #region payload
// The service does not define the body of an invocation. This is this agent's own contract.
// strictObject: a body that also carries `owner`, `actorId` or `messages` is refused, not trimmed.
export const invocationSchema = v.strictObject({
  // A string and nothing else: a list of content blocks here could carry a ready-made tool request.
  prompt: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(MAX_QUESTION_CHARS)),
});
export type Invocation = v.InferOutput<typeof invocationSchema>;
// #endregion payload

// #region ping
/** What `GET /ping` answers. `HealthyBusy` would keep an idle session alive, and billed. */
export const pingSchema = v.object({ status: v.picklist(["Healthy", "HealthyBusy"]) });
// #endregion ping

// #region error
export const errorCodes = [
  "invalid_request",
  "unauthorized",
  "session_owner_mismatch",
  "payload_too_large",
  "not_found",
  "internal",
] as const;

export const errorSchema = v.object({
  error: v.object({
    code: v.picklist(errorCodes),
    message: v.string(),
    requestId: v.string(),
  }),
});
export type ErrorBody = v.InferOutput<typeof errorSchema>;
// #endregion error
