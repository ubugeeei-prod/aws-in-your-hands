import { identityFromApiGateway } from "@aih/example-06-auth/api/src/identity.ts";
import { S3Client } from "@aws-sdk/client-s3";
import { handle } from "hono/aws-lambda";
import { z } from "zod";
import { composeApp } from "./compose.ts";
import { parseUploadsEnv } from "./env.ts";
import { S3ObjectStore } from "./s3-object-store.ts";

// #region handler
const clientId = z.string().min(1, "USER_POOL_CLIENT_ID is required").parse(process.env["USER_POOL_CLIENT_ID"]);
const uploads = parseUploadsEnv(process.env);
if (uploads.UPLOADS_STORE !== "s3") {
  throw new Error("A deployment keeps uploads in S3. Set UPLOADS_STORE=s3 and UPLOADS_BUCKET.");
}

// Created once per execution environment. Every presigned URL and form is
// signed with the execution role's temporary credentials, which the SDK
// reads from the environment.
const objects = new S3ObjectStore(new S3Client({}), uploads.UPLOADS_BUCKET);

const app = composeApp(process.env, async ({ event }) => identityFromApiGateway(event, clientId), objects);

export const handler = handle(app);
// #endregion handler
