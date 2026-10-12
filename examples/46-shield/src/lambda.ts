import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeApp } from "./compose.ts";

const app = composeApp(process.env);

// A function URL hands over the same event as an HTTP API: payload format 2.0.
export const handler = handleApiGateway(app);
