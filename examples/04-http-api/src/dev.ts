import { serve } from "@hono/node-server";
import { composeApp } from "./compose.ts";

// #region dev
// The same application as on Lambda, behind a plain Node HTTP server. No
// Docker, no AWS credentials, no charges. What it does not reproduce: the
// API Gateway event format, the Lambda timeout and memory limit, IAM, and
// cold starts.
const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`notes API listening on http://localhost:${info.port} (restarts when a source file changes)`);
});
// #endregion dev
