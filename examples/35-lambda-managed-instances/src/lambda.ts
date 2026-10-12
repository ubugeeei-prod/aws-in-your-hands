import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { composeManagedApp } from "./app.ts";

// #region handler
// Runs once per worker thread. After that, the same `app` answers many requests at once.
const app = composeManagedApp(process.env);

// An async function: Node.js 22 on Managed Instances refuses callback handlers.
export const handler = handleApiGateway(app);
// #endregion handler
