import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeObservedApp } from "./compose.ts";

// #region handler
// No tracing SDK is imported here. Spans are recorded only when the function
// has the OpenTelemetry layer, which registers one before this file loads.
const app = composeObservedApp(process.env);

export const handler = handleApiGateway(app);
// #endregion handler
