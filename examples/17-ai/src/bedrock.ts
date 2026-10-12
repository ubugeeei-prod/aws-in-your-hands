import { BedrockRuntimeClient, ConverseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

import type { ModelGateway } from "./summarize.ts";

// #region bedrock
export function createBedrockGateway(region: string): ModelGateway {
  // The SDK would retry on its own (3 attempts by default). Retries live in
  // summarize.ts instead, where they are bounded by one deadline and tested.
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
