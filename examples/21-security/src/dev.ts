import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeApp } from "./compose.ts";

const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8796);

nodeServer(app).listen(port, () => {
  console.log(`token API listening on http://localhost:${port} (secret source: memory)`);
});
