import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeRollout } from "./compose.ts";

// #region dev
// FLAGS_FILE is read on every request: edit flags/flags.json and the next request sees it.
const app = composeRollout(process.env);
const port = Number(process.env["PORT"] ?? 8787);

nodeServer(app).listen(port, () => {
  console.log(`notes API with flags on http://localhost:${port}`);
});
// #endregion dev
