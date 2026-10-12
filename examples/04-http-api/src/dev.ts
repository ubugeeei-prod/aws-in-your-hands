import { composeApp } from "./compose.ts";
import { nodeServer } from "./http/node-server.ts";

// #region dev
// The same app as on Lambda, behind a plain Node server.
const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8787);

nodeServer(app).listen(port, () => {
  console.log(`notes API on http://localhost:${port}`);
});
// #endregion dev
