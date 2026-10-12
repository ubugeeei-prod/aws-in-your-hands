import { handle } from "hono/aws-lambda";

import { composeApp } from "./compose.ts";

// #region handler
// Once per execution environment. With KV_STORE=memory the counters and the
// cache live right here, and each environment has its own.
const app = composeApp(process.env);

export const handler = handle(app);
// #endregion handler
