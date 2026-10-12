import { handle } from "hono/aws-lambda";

import { composeApp } from "./compose.ts";

// #region handler
// Runs once per execution environment (a cold start), not once per request.
const app = composeApp(process.env);

export const handler = handle(app);
// #endregion handler
