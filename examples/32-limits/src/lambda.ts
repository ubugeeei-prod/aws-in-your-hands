import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeApp } from "./compose.ts";

// No throttle in here. In AWS the stage refuses before this code runs, and a counter kept
// in this process would be one per execution environment, not one per API.
const app = composeApp(process.env);

export const handler = handleApiGateway(app);
