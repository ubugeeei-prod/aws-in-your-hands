import { S3Client } from "@aws-sdk/client-s3";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { createBedrockGateway } from "./bedrock.ts";
import { composeApp } from "./compose.ts";
import { parseEnv } from "./env.ts";
import { ownerFromFunctionUrl } from "./identity.ts";
import { S3Media } from "./s3-media.ts";

// #region handler
const env = parseEnv(process.env);
if (env.NOVA_BACKEND !== "bedrock" || env.MEDIA_BUCKET === undefined) {
  throw new Error("The deployed function only talks to Bedrock. Set NOVA_BACKEND=bedrock.");
}

// A function URL writes the same event as an HTTP API (payload format 2.0), so chapter 04's
// adapter fits. Nothing is streamed: the answer is one small JSON object.
export const handler = handleApiGateway(
  composeApp(env, {
    media: new S3Media(new S3Client({}), env.MEDIA_BUCKET),
    model: createBedrockGateway(env.AWS_REGION),
    ownerOf: ({ event }) => ownerFromFunctionUrl(event),
  }),
);
// #endregion handler
