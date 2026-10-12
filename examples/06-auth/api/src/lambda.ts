import * as v from "valibot";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeApp } from "./compose.ts";
import { identityFromApiGateway } from "./identity.ts";

// #region handler
const clientIdMessage = "USER_POOL_CLIENT_ID is required";
const clientId = v.parse(
  v.pipe(v.string(clientIdMessage), v.minLength(1, clientIdMessage)),
  process.env["USER_POOL_CLIENT_ID"],
);

// Identity comes only from what API Gateway verified, never from the
// Authorization header. local-auth.ts is not imported, so it stays out of the bundle.
const app = composeApp(process.env, async ({ event }) => identityFromApiGateway(event, clientId));

// handleApiGateway passes the event along with the request. That is how `event` gets there.
export const handler = handleApiGateway(app);
// #endregion handler
