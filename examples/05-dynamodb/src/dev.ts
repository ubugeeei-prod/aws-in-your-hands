import { serve } from "@hono/node-server";

import { composeApp } from "./compose.ts";

const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  const store =
    process.env["NOTES_STORE"] === "dynamodb"
      ? `DynamoDB at ${process.env["DYNAMODB_ENDPOINT"] ?? "AWS"}`
      : "memory";
  console.log(`notes API listening on http://localhost:${info.port} (store: ${store})`);
});
