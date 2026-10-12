import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// #region types
/** One HTTP request as the endpoint received it. */
export type ReceivedCall = {
  /** `GetItem` for a JSON-protocol service (from `x-amz-target`); `PUT /bucket/key` otherwise. */
  operation: string;
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /** Which TCP connection carried it, counted from 1. */
  connection: number;
};

export type Answer =
  | { status: number; headers?: Record<string, string>; body?: string | Uint8Array }
  // Accepts the request and never answers: what a timeout looks like from the client.
  | { hang: true };

export type Script = (call: ReceivedCall, index: number) => Answer | Promise<Answer>;
// #endregion types

// #region answers
let requestCounter = 0;
// A real service names each request it answers. The SDK copies this into `$metadata.requestId`.
const nextRequestId = (): string => `LOCAL${String((requestCounter += 1)).padStart(8, "0")}`;

/** A success in the AWS JSON 1.0 protocol, which DynamoDB speaks. */
export function json(body: unknown, headers: Record<string, string> = {}): Answer {
  return {
    status: 200,
    headers: { "content-type": "application/x-amz-json-1.0", ...headers },
    body: JSON.stringify(body),
  };
}

/** An error in the same protocol: the status, and the error's code in `__type`. */
export function jsonError(
  status: number,
  code: string,
  message = "answered by the local endpoint",
  headers: Record<string, string> = {},
): Answer {
  return {
    status,
    headers: { "content-type": "application/x-amz-json-1.0", ...headers },
    body: JSON.stringify({ __type: `com.amazonaws.dynamodb.v20120810#${code}`, message }),
  };
}

/** A body in S3's protocol, which is XML over REST. */
export function xml(body: string, headers: Record<string, string> = {}): Answer {
  return {
    status: 200,
    headers: { "content-type": "application/xml", ...headers },
    body: `<?xml version="1.0" encoding="UTF-8"?>${body}`,
  };
}
// #endregion answers

export type LocalEndpoint = {
  /** `http://127.0.0.1:<port>`: what goes in a client's `endpoint`. */
  url: string;
  calls: ReceivedCall[];
  /** TCP connections accepted so far. */
  connections: () => number;
  close: () => Promise<void>;
};

// #region endpoint
/**
 * A server on the loopback interface that answers from a script. It knows two protocols' framing
 * and nothing about any service: no table, no bucket, no signature check.
 */
export async function startLocalEndpoint(script: Script): Promise<LocalEndpoint> {
  const calls: ReceivedCall[] = [];
  const connectionIds = new WeakMap<object, number>();
  let connections = 0;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://local");
      const target = request.headers["x-amz-target"];
      const call: ReceivedCall = {
        operation:
          typeof target === "string"
            ? target.slice(target.indexOf(".") + 1)
            : `${request.method} ${url.pathname}`,
        method: request.method ?? "",
        path: url.pathname,
        query: url.searchParams,
        headers: request.headers,
        body: Buffer.concat(chunks),
        connection: connectionIds.get(request.socket) ?? 0,
      };
      calls.push(call);
      void Promise.resolve(script(call, calls.length - 1)).then((answer) => {
        if ("hang" in answer) {
          return;
        }
        response.writeHead(answer.status, {
          "x-amzn-requestid": nextRequestId(),
          ...answer.headers,
        });
        response.end(answer.body);
      });
    });
  });
  server.on("connection", (socket) => {
    connections += 1;
    connectionIds.set(socket, connections);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    connections: () => connections,
    close: () =>
      new Promise<void>((resolve) => {
        // Hung requests and keep-alive sockets would hold the server open.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
// #endregion endpoint

// #region client-config
/** What every client in this chapter is given so that it talks to the local endpoint only. */
export function localClientConfig(endpoint: Pick<LocalEndpoint, "url">) {
  return {
    endpoint: endpoint.url,
    region: "ap-northeast-1",
    // Not real keys. Given explicitly, so the default provider chain is never consulted.
    credentials: { accessKeyId: "AKIDLOCALEXAMPLE", secretAccessKey: "local-secret" },
  } as const;
}
// #endregion client-config
