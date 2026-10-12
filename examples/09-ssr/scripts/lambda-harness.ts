// Calls the handler that `nuxt build` wrote, the way a Lambda function URL
// would, without Lambda. It checks the shape Nitro 2.13.4 produces, not that
// Lambda accepts it.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as v from "valibot";

import type { CacheRequest, CacheResponse } from "../test/support/shared-cache.ts";

// #region nitro-json
const nitroJsonSchema = v.object({
  preset: v.literal("aws-lambda"),
  versions: v.object({ nitro: v.string() }),
  config: v.object({ awsLambda: v.object({ streaming: v.boolean() }) }),
});

/** What the build says about itself. The stack reads the same file. */
export function readBuildInfo(outputDir: string): { streaming: boolean; nitro: string } {
  const info = v.parse(
    nitroJsonSchema,
    JSON.parse(readFileSync(join(outputDir, "nitro.json"), "utf8")),
  );
  return { streaming: info.config.awsLambda.streaming, nitro: info.versions.nitro };
}
// #endregion nitro-json

const headersSchema = v.record(v.string(), v.string());
const bufferedResultSchema = v.object({
  statusCode: v.pipe(v.number(), v.integer()),
  headers: headersSchema,
  cookies: v.optional(v.array(v.string())),
  body: v.string(),
  isBase64Encoded: v.boolean(),
});
const streamMetadataSchema = v.object({
  statusCode: v.pipe(v.number(), v.integer()),
  headers: headersSchema,
  cookies: v.optional(v.array(v.string())),
});

export type Invocation = CacheResponse & {
  cookies: string[];
  /** Milliseconds from the start of the call to each write. One entry for a buffered handler. */
  writesAt: number[];
};

// #region event
/** A function URL event (payload format 2.0), reduced to the fields Nitro reads. */
function functionUrlEvent(request: CacheRequest & { body?: string }) {
  const [rawPath = "/", rawQueryString = ""] = request.path.split("?");
  const { cookie, ...headers } = request.headers;
  return {
    version: "2.0",
    rawPath,
    rawQueryString,
    queryStringParameters: Object.fromEntries(new URLSearchParams(rawQueryString)),
    // Lambda moves the Cookie header into this array.
    ...(cookie === undefined ? {} : { cookies: cookie.split("; ") }),
    headers,
    requestContext: { http: { method: request.method, path: rawPath } },
    body: request.body,
    isBase64Encoded: false,
  };
}
// #endregion event

const lowerCased = (headers: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

export async function loadHandler(outputDir: string) {
  const { streaming } = readBuildInfo(outputDir);
  if (streaming) {
    // #region fake-runtime
    // The Lambda Node.js runtime provides this global. Here it only records what the handler does with it.
    Object.assign(globalThis, {
      awslambda: {
        streamifyResponse: (handler: unknown) => handler,
        HttpResponseStream: {
          from: (stream: { metadata?: unknown }, metadata: unknown) => {
            stream.metadata = metadata;
            return stream;
          },
        },
      },
    });
    // #endregion fake-runtime
  }
  const module: unknown = await import(pathToFileURL(join(outputDir, "server/index.mjs")).href);
  const { handler } = v.parse(
    v.object({
      handler: v.custom<(...args: unknown[]) => unknown>((value) => typeof value === "function"),
    }),
    module,
  );

  return async (request: CacheRequest & { body?: string }): Promise<Invocation> => {
    const event = functionUrlEvent(request);
    const startedAt = performance.now();
    if (!streaming) {
      const result = v.parse(bufferedResultSchema, await handler(event, {}));
      return {
        status: result.statusCode,
        headers: lowerCased(result.headers),
        cookies: result.cookies ?? [],
        body: result.isBase64Encoded
          ? Buffer.from(result.body, "base64").toString("utf8")
          : result.body,
        writesAt: [performance.now() - startedAt],
      };
    }

    const chunks: Buffer[] = [];
    const writesAt: number[] = [];
    const responseStream: {
      metadata?: unknown;
      write(chunk: string | Uint8Array): void;
      end(): void;
    } = {
      write: (chunk) => {
        chunks.push(Buffer.from(chunk));
        writesAt.push(performance.now() - startedAt);
      },
      end: () => {},
    };
    await handler(event, responseStream, {});
    const metadata = v.parse(streamMetadataSchema, responseStream.metadata);
    return {
      status: metadata.statusCode,
      headers: lowerCased(metadata.headers),
      cookies: metadata.cookies ?? [],
      body: Buffer.concat(chunks).toString("utf8"),
      writesAt,
    };
  };
}
