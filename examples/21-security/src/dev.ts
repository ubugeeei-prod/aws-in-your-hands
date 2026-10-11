import { serve } from "@hono/node-server";
import { composeApp } from "./compose.ts";

const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8796);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`token API listening on http://localhost:${info.port} (secret source: memory)`);
});
