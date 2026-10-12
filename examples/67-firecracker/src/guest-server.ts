// What runs inside the microVM: the chapter 04 app, unchanged, behind a plain Node.js server.

import { composeApp } from "@aih/example-04-http-api/src/compose.ts";
import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

// #region guest
const port = Number(process.env["PORT"] ?? 8080);

// Every address of the guest: the host reaches it through the TAP device, not through loopback.
nodeServer(composeApp(process.env)).listen(port, "0.0.0.0", () => {
  console.log(`notes API on port ${port}`);
});
// #endregion guest
