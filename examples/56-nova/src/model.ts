import type { ConverseRequest } from "./image.ts";

// #region gateway
/** The one call this example makes to a model. Bedrock in production, a script in tests. */
export type ModelGateway = {
  /** The whole answer at once: a description is short, and nothing shows it while it grows. */
  converse(request: ConverseRequest, signal: AbortSignal): Promise<unknown>;
};
// #endregion gateway
