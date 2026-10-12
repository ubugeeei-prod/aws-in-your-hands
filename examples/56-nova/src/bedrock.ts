import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

import type { ModelGateway } from "./model.ts";

// #region bedrock
export function createBedrockGateway(region: string): ModelGateway {
  // One attempt. A failed call gives the claim back, and the caller's next request is the retry.
  const client = new BedrockRuntimeClient({ region, maxAttempts: 1 });
  return {
    converse: (request, signal) =>
      client.send(new ConverseCommand(request), { abortSignal: signal }),
  };
}
// #endregion bedrock
