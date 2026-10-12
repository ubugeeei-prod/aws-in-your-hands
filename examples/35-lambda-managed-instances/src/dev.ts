import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeManagedApp } from "./app.ts";
import { asyncScope, moduleScope } from "./scope.ts";

// #region dev
// A Node.js server has always answered many requests in one process.
// `SCOPE=module` starts the version that mixes them up.
const scope = process.env["SCOPE"] === "module" ? moduleScope : asyncScope;
const app = composeManagedApp(process.env, scope);
const port = Number(process.env["PORT"] ?? 8787);

nodeServer(app).listen(port, () => {
  console.log(`notes API on http://localhost:${port}`);
});
// #endregion dev
