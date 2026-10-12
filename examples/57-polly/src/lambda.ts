import { PollyClient } from "@aws-sdk/client-polly";
import { S3Client } from "@aws-sdk/client-s3";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { createPollySynthesizer } from "./polly.ts";
import { S3AudioCache } from "./s3-audio-cache.ts";

// #region handler
const env = parseEnv(process.env);
if (env.SPEECH_BACKEND !== "polly") {
  throw new Error("The deployed function only talks to Polly. Set SPEECH_BACKEND=polly.");
}

// Made once per execution environment. A function URL writes the same event as an HTTP API.
export const handler = handleApiGateway(
  composeApp(
    env,
    new S3AudioCache(new S3Client({}), env.SPEECH_BUCKET),
    createPollySynthesizer(new PollyClient({})),
  ),
);
// #endregion handler
