import type { Message } from "@aih/example-36-bedrock/src/converse.ts";
import type { ModelGateway } from "@aih/example-36-bedrock/src/gateway.ts";

// #region with-history
/**
 * Chapter 36's loop starts every conversation at the question. This puts the session's
 * earlier exchanges in front of whatever the loop sends, without the loop knowing.
 */
export function withHistory(gateway: ModelGateway, history: readonly Message[]): ModelGateway {
  return {
    converseStream: (request, signal) =>
      gateway.converseStream({ ...request, messages: [...history, ...request.messages] }, signal),
  };
}
// #endregion with-history
