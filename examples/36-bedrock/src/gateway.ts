import type { ConverseRequest } from "./converse.ts";

// #region gateway
/**
 * The one call this example makes to a model: chapter 17's interface, with a request wide
 * enough for tools, a guardrail, and a JSON schema. Bedrock in production, a script in tests.
 */
export type ModelGateway = {
  /** Resolves when the model has accepted the request. The events arrive afterwards. */
  converseStream(request: ConverseRequest, signal: AbortSignal): Promise<AsyncIterable<unknown>>;
};
// #endregion gateway
