import { handle } from "hono/aws-lambda";
import { z } from "zod";
import { composeApp } from "./compose.ts";
import { identityFromApiGateway } from "./identity.ts";

// #region handler
const clientId = z.string().min(1, "USER_POOL_CLIENT_ID is required").parse(process.env["USER_POOL_CLIENT_ID"]);

// In AWS the only source of identity is what API Gateway's JWT authorizer
// verified and placed in the event. The Authorization header is not read
// here, and the local development sign-in (local-auth.ts) is not imported,
// so it is not in the deployed bundle.
const app = composeApp(process.env, async ({ event }) => identityFromApiGateway(event, clientId));

export const handler = handle(app);
// #endregion handler
