import { serve } from "@hono/node-server";

import { composeApp } from "./compose.ts";

const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8794);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(
    `items API listening on http://localhost:${info.port} (store: ${process.env["KV_STORE"]})`,
  );
});
