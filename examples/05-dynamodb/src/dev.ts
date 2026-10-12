import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeApp } from "./compose.ts";

const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8787);

nodeServer(app).listen(port, () => {
  const store =
    process.env["NOTES_STORE"] === "dynamodb"
      ? `DynamoDB at ${process.env["DYNAMODB_ENDPOINT"] ?? "AWS"}`
      : "memory";
  console.log(`notes API listening on http://localhost:${port} (store: ${store})`);
});
