import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import * as v from "valibot";

import type { Embedder } from "./embedder.ts";

// #region titan
export const TITAN_EMBED_V2 = "amazon.titan-embed-text-v2:0";
/** Titan Text Embeddings V2 can also answer with 512 or 256. An index holds one size, for good. */
export const EMBEDDING_DIMENSIONS = 1024;

const responseSchema = v.object({
  embedding: v.array(v.pipe(v.number(), v.finite())),
  // What the call is billed for.
  inputTextTokenCount: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export function createTitanEmbedder(
  region: string,
  onTokens: (tokens: number) => void = () => {},
): Embedder {
  const client = new BedrockRuntimeClient({ region });
  return {
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(text) {
      const response = await client.send(
        new InvokeModelCommand({
          modelId: TITAN_EMBED_V2,
          contentType: "application/json",
          accept: "application/json",
          // Unit length, so cosine distance depends on direction alone.
          body: JSON.stringify({
            inputText: text,
            dimensions: EMBEDDING_DIMENSIONS,
            normalize: true,
          }),
        }),
      );
      const parsed = v.parse(responseSchema, JSON.parse(new TextDecoder().decode(response.body)));
      if (parsed.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Titan answered with ${parsed.embedding.length} dimensions`);
      }
      onTokens(parsed.inputTextTokenCount);
      return parsed.embedding;
    },
  };
}
// #endregion titan
