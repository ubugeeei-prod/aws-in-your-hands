import { handle } from "hono/aws-lambda";
import { composeObservedApp } from "./compose.ts";

// #region handler
// No tracing SDK is imported here. Spans are recorded only when the function
// has the OpenTelemetry layer, which registers one before this file loads.
const app = composeObservedApp(process.env);

export const handler = handle(app);
// #endregion handler
