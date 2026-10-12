import { handle } from "hono/aws-lambda";

import { composeApp } from "./compose.ts";

// #region handler
// Once per execution environment. The key cache lives here, so each environment has its own.
const app = composeApp(process.env);

export const handler = handle(app);
// #endregion handler
