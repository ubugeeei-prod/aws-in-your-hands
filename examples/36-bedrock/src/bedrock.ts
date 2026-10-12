import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

import type { ModelGateway } from "./gateway.ts";

// #region bedrock
export function createBedrockGateway(region: string): ModelGateway {
  // One attempt per call. Retries live in loop.ts, under one deadline and one budget.
  const client = new BedrockRuntimeClient({ region, maxAttempts: 1 });
  return {
    async converseStream(request, signal) {
      const response = await client.send(new ConverseStreamCommand(request), {
        abortSignal: signal,
      });
      if (response.stream === undefined) {
        throw new Error("ConverseStream answered without a stream");
      }
      return response.stream;
    },
  };
}
// #endregion bedrock
