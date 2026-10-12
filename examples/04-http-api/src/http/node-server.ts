// The same handler behind a plain Node.js server, for running on your own machine
// and anywhere a process listens on a port.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { Readable } from "node:stream";

import type { Handler } from "./router.ts";

/** What a Request cannot carry here: who is on the other end of the socket. */
export type NodeContext = { remoteAddress: string | undefined };

function toRequest(incoming: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    for (const one of [value].flat()) {
      if (one !== undefined) {
        headers.append(name, one);
      }
    }
  }
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  return new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
    method: incoming.method ?? "GET",
    headers,
    signal,
    ...(hasBody
      ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" as const }
      : {}),
  });
}

// #region node-server
/** Not listening yet: call `.listen(port)` on what comes back, and `.close()` to stop. */
export function nodeServer(handler: Handler<NodeContext>): Server {
  return createServer((incoming, outgoing) => {
    // The caller going away, before the answer is all written, ends whatever the handler
    // is still waiting for: `request.signal` aborts, and a body still streaming is cancelled.
    const gone = new AbortController();
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) {
        gone.abort();
      }
    });
    void (async () => {
      let response: Response;
      try {
        response = await handler(toRequest(incoming, gone.signal), {
          remoteAddress: incoming.socket.remoteAddress,
        });
      } catch (error) {
        // A handler is expected to answer its own failures. This is the net under it.
        console.error(error);
        response = new Response(null, { status: 500 });
      }
      outgoing.statusCode = response.status;
      const cookies = response.headers.getSetCookie();
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") {
          outgoing.setHeader(name, value);
        }
      });
      if (cookies.length > 0) {
        outgoing.setHeader("set-cookie", cookies);
      }
      if (response.body === null) {
        outgoing.end();
        return;
      }
      // Piped, not buffered, so a response that streams reaches the caller as it is written.
      const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      gone.signal.addEventListener("abort", () => body.destroy());
      body.on("error", () => outgoing.destroy()).pipe(outgoing);
    })();
  });
}
// #endregion node-server
