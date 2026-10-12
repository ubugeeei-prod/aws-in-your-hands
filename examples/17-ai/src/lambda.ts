import { streamHandle } from "hono/aws-lambda";

import { createBedrockGateway } from "./bedrock.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";

// #region handler
const env = parseEnv(process.env);
if (env.AI_BACKEND !== "bedrock") {
  throw new Error("The deployed function only talks to Bedrock. Set AI_BACKEND=bedrock.");
}

// streamHandle wraps the app in awslambda.streamifyResponse, which the
// Node.js runtime on Lambda provides. It does not exist anywhere else.
export const handler = streamHandle(composeApp(env, createBedrockGateway(env.AWS_REGION)));
// #endregion handler
