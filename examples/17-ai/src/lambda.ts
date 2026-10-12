import { createBedrockGateway } from "./bedrock.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { streamFunctionUrl } from "./function-url.ts";

// #region handler
const env = parseEnv(process.env);
if (env.AI_BACKEND !== "bedrock") {
  throw new Error("The deployed function only talks to Bedrock. Set AI_BACKEND=bedrock.");
}

// `awslambda` is not imported: the Node.js runtime on Lambda defines it before this file runs.
export const handler = streamFunctionUrl(
  composeApp(env, createBedrockGateway(env.AWS_REGION)),
  awslambda,
);
// #endregion handler
