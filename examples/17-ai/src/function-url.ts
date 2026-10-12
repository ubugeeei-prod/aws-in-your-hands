// A function URL in RESPONSE_STREAM mode does not wait for an object to come back. It
// hands the function a stream and sends on whatever is written to it. The two functions
// that make this work are on `awslambda`, a global that only Lambda's Node.js runtime has.

import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Context, LambdaFunctionURLEvent } from "aws-lambda";

import { toRequest } from "@aih/example-04-http-api/src/http/api-gateway.ts";
import type { Fetch } from "@aih/example-04-http-api/src/http/router.ts";

// #region awslambda
/** What Lambda needs before the body: the first lines of the HTTP response, as JSON. */
export type Prelude = {
  statusCode: number;
  headers: Record<string, string>;
  cookies?: string[];
};

/** Lambda's stream to the caller: a Node.js Writable with one method more. */
export type ResponseStream = Writable & { setContentType(contentType: string): void };

export type StreamHandler = (
  event: LambdaFunctionURLEvent,
  responseStream: ResponseStream,
  context: Context,
) => unknown;

/** The part of the `awslambda` global this file calls. Nothing exports it: it is just there. */
export type Awslambda = {
  /** Marks a handler as one that writes its answer instead of returning it. */
  streamifyResponse(handler: StreamHandler): StreamHandler;
  HttpResponseStream: {
    /** Puts the prelude ahead of whatever is written next. */
    from(responseStream: ResponseStream, prelude: Prelude): ResponseStream;
  };
};
// #endregion awslambda

// #region stream-function-url
/** `runtime` is a parameter so that a test can pass a stand-in. On Lambda it is the global. */
export function streamFunctionUrl(app: Fetch, runtime: Awslambda): StreamHandler {
  return runtime.streamifyResponse(async (event, responseStream) => {
    // A function URL writes the same event as an HTTP API (payload format 2.0).
    const response = await app(toRequest(event));
    const headers: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie") {
        headers[name] = value;
      }
    });
    const cookies = response.headers.getSetCookie();
    const out = runtime.HttpResponseStream.from(responseStream, {
      statusCode: response.status,
      headers,
      ...(cookies.length === 0 ? {} : { cookies }),
    });
    if (response.body === null) {
      // Nothing to pipe. The empty write is there so that the prelude still goes out.
      out.write("");
      out.end();
      return;
    }
    // Each chunk goes out as it is produced. If writing fails, the body is cancelled,
    // which is how the app learns that nobody is reading.
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), out);
  });
}
// #endregion stream-function-url
