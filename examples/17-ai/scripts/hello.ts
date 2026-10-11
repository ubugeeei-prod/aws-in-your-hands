// vp run ai:hello
//   node scripts/hello.ts
//
// One Converse call from this machine, with your own credentials. BILLED:
// a few dozen tokens of the model named by BEDROCK_MODEL_ID.
import { preflight } from "@aih/tools/aws/preflight.ts";
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { converseResponseSchema } from "../src/converse-stream.ts";
import { parseEnv } from "../src/env.ts";

try {
  const env = parseEnv({ ...process.env, AI_BACKEND: "bedrock" });
  const { target } = await preflight({ access: "mutate", action: `call ${env.BEDROCK_MODEL_ID} once (billed)` });

  // #region hello
  const client = new BedrockRuntimeClient({ region: target.region });
  const response = await client.send(
    new ConverseCommand({
      modelId: env.BEDROCK_MODEL_ID,
      messages: [{ role: "user", content: [{ text: "Say hello in Japanese, in one short sentence." }] }],
      inferenceConfig: { maxTokens: 60 },
    }),
  );
  // #endregion hello

  // #region validate
  // The SDK's types describe what the service promises. This checks what arrived.
  const result = converseResponseSchema.parse(response);
  const text = result.output.message.content.map((block) => block.text ?? "").join("");
  console.log(text);
  console.log(`stop: ${result.stopReason}, tokens in/out: ${result.usage.inputTokens}/${result.usage.outputTokens}`);
  // #endregion validate
} catch (error) {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
}
