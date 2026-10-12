import { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { serve } from "@hono/node-server";

export type ShutdownResult = "drained" | "forced";

export type RunningServer = {
  port: number;
  /** Idempotent: a second signal gets the promise of the first. */
  shutdown: () => Promise<ShutdownResult>;
};

export type ServeOptions = {
  fetch: (request: Request) => Response | Promise<Response>;
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
    const server = serve(
      {
        fetch: options.fetch,
        port: options.port,
        // Longer than the load balancer's idle timeout, so the load balancer is the side that hangs up.
        serverOptions: { keepAliveTimeout: options.keepAliveTimeoutMs },
      },
      (info: AddressInfo) => resolve({ port: info.port, shutdown }),
    );
    if (!(server instanceof Server)) {
      throw new Error("expected a plain HTTP/1.1 server");
    }
    server.once("error", reject);
    // Without a number here, the only limit on open sockets is the task's memory.
    server.maxConnections = options.maxConnections;

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
