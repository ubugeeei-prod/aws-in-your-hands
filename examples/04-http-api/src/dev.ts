import { serve } from "@hono/node-server";

import { composeApp } from "./compose.ts";

// #region dev
// The same app as on Lambda, behind a plain Node server.
const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`notes API on http://localhost:${info.port}`);
});
// #endregion dev
