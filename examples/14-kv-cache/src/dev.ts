import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";

import { composeApp } from "./compose.ts";

const app = composeApp(process.env);
const port = Number(process.env["PORT"] ?? 8794);

// #region dev
// A Request does not say who sent it. The server knows the other end of the socket.
nodeServer((request, { remoteAddress }) => app(request, { sourceAddress: remoteAddress })).listen(
  port,
  () => {
    console.log(
      `items API listening on http://localhost:${port} (store: ${process.env["KV_STORE"]})`,
    );
  },
);
// #endregion dev
