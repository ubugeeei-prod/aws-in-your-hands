import type { AddressInfo } from "node:net";

import { nodeServer } from "@aih/example-04-http-api/src/http/node-server.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

export type ShutdownResult = "drained" | "forced";

export type RunningServer = {
  port: number;
  /** Idempotent: a second signal gets the promise of the first. */
  shutdown: () => Promise<ShutdownResult>;
};

export type ServeOptions = {
  fetch: Fetch;
  /** 0 asks the OS for a free port. */
  port: number;
  keepAliveTimeoutMs: number;
  /** Past this many open connections, new ones are closed unanswered. */
  maxConnections: number;
  shutdownDeadlineMs: number;
};

// #region serve
export function startServer(options: ServeOptions): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    // Chapter 04's Node.js server: a plain node:http Server, not listening yet.
    const server = nodeServer(options.fetch);
    // Longer than the load balancer's idle timeout, so the load balancer is the side that hangs up.
    server.keepAliveTimeout = options.keepAliveTimeoutMs;
    // Without a number here, the only limit on open sockets is the task's memory.
    server.maxConnections = options.maxConnections;
    server.once("error", reject);
    server.listen(options.port, () =>
      resolve({ port: (server.address() as AddressInfo).port, shutdown }),
    );

    let closing: Promise<ShutdownResult> | undefined;
    const shutdown = (): Promise<ShutdownResult> => {
      closing ??= new Promise<ShutdownResult>((done) => {
        // Past the deadline, whatever is still open is cut, and the caller is told so.
        const deadline = setTimeout(() => {
          server.closeAllConnections();
          done("forced");
        }, options.shutdownDeadlineMs);

        // Stops listening and drops idle keep-alive connections. Requests in flight keep their connection.
        server.close(() => {
          clearTimeout(deadline);
          clearInterval(sweep);
          done("drained");
        });
        // close() looks for idle connections once. One that was busy then stays open, idle, after its
        // response; without this sweep the server would sit until the keep-alive timeout or the deadline.
        const sweep = setInterval(() => server.closeIdleConnections(), 50);
        sweep.unref();
      });
      return closing;
    };
  });
}
// #endregion serve
