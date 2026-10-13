import type { AddressInfo } from "node:net";

import { type NodeContext, nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import type { Handler } from "@aih/example-04-http-api/src/http/router.ts";

import type { ListenAddress } from "./listen.ts";

// #region budget
// Lambda gives the process one second after SIGTERM. The rest is left for the exit itself.
export const SHUTDOWN_BUDGET_MS = 800;
// #endregion budget

export type Running = {
  address: AddressInfo;
  /** "drained": every answer was finished. "cut": the time ran out with requests still open. */
  stop(withinMs: number): Promise<"drained" | "cut">;
};

const timer = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    // unref: a timer that is no longer needed must not keep the process alive.
    setTimeout(resolve, ms).unref();
  });

// #region serve
/** Resolves once the socket accepts connections: the moment Lambda counts the environment as ready. */
export async function serve(
  app: Handler<NodeContext>,
  { host, port }: ListenAddress,
  wait: (ms: number) => Promise<void> = timer,
): Promise<Running> {
  const server = nodeServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    address: server.address() as AddressInfo,
    stop(withinMs) {
      const drained = new Promise<"drained">((resolve) => {
        // No new connections from here on. The callback runs when the open ones are gone.
        server.close(() => resolve("drained"));
      });
      // Connections kept alive with no request on them would hold close() open.
      server.closeIdleConnections();
      const cut = wait(withinMs).then(() => {
        server.closeAllConnections();
        return "cut" as const;
      });
      return Promise.race([drained, cut]);
    },
  };
}
// #endregion serve
