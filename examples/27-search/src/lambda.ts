import { createLogger } from "@aih/example-04-http-api/src/log.ts";
import { streamFunctionUrl } from "@aih/example-17-ai/src/function-url.ts";

import { awsParts } from "./aws-parts.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";

// #region handler
const env = parseEnv(process.env);
if (env.SEARCH_BACKEND !== "aws") {
  throw new Error("The deployed function only talks to AWS. Set SEARCH_BACKEND=aws.");
}

// Chapter 17's adapter: the answer is written to the caller as the model produces it.
export const handler = streamFunctionUrl(
  composeApp(env, awsParts(env, createLogger(env.LOG_LEVEL))),
  awslambda,
);
// #endregion handler
