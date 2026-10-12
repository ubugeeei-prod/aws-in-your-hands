import { handle } from "hono/aws-lambda";
import { z } from "zod";

import { composeApp } from "./compose.ts";
import { identityFromApiGateway } from "./identity.ts";

// #region handler
const clientId = z
  .string()
  .min(1, "USER_POOL_CLIENT_ID is required")
  .parse(process.env["USER_POOL_CLIENT_ID"]);

// Identity comes only from what API Gateway verified, never from the
// Authorization header. local-auth.ts is not imported, so it stays out of the bundle.
const app = composeApp(process.env, async ({ event }) => identityFromApiGateway(event, clientId));

export const handler = handle(app);
// #endregion handler
