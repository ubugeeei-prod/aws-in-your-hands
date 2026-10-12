// vp run dev:edge
//   node --watch src/local/dev.ts
// The deployed function file in front of the files in site/, with edge-data.json standing in for the store.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import * as v from "valibot";

import { edgeDataSchema, toEntries } from "../kvs/config.ts";
import {
  isGeneratedResponse,
  loadViewerRequestFunction,
  mapKvs,
  type ViewerRequestEvent,
} from "./load-function.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const siteDir = join(root, "site");
const port = Number(process.env["PORT"] ?? 8790);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

// #region dev
// Read on every request: an edit to edge-data.json shows up at once. The real store takes its time.
const kvs = mapKvs(() =>
  toEntries(
    v.parse(edgeDataSchema, JSON.parse(readFileSync(join(root, "edge-data.json"), "utf8"))),
  ),
);
const handler = loadViewerRequestFunction(
  new URL("../../infra/functions/edge-router.js", import.meta.url),
  kvs,
);

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const event: ViewerRequestEvent = {
    version: "1.0",
    context: { eventType: "viewer-request" },
    request: {
      method: request.method ?? "GET",
      uri: url.pathname,
      querystring: Object.fromEntries(
        [...url.searchParams].map(([key, value]) => [key, { value }]),
      ),
      headers: {},
      cookies: {},
    },
  };

  const before = kvs.reads.length;
  const result = await handler(event);
  const reads = kvs.reads.slice(before).join(", ");

  if (isGeneratedResponse(result)) {
    const headers = Object.fromEntries(
      Object.entries(result.headers ?? {}).map(([name, entry]) => [name, entry.value]),
    );
    response.writeHead(result.statusCode, headers).end(result.body?.data ?? "");
    console.log(`${result.statusCode} ${url.pathname} (function answered; reads: ${reads})`);
    return;
  }

  // What the private S3 origin would do: the exact key, or 404.
  const file = normalize(join(siteDir, result.uri));
  try {
    if (!file.startsWith(siteDir)) {
      throw new Error("outside site/");
    }
    const body = readFileSync(file);
    response
      .writeHead(200, {
        "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      })
      .end(body);
    console.log(`200 ${url.pathname} -> ${result.uri} (reads: ${reads})`);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not Found\n");
    console.log(`404 ${url.pathname} -> ${result.uri} (reads: ${reads})`);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`edge router in front of site/ at http://localhost:${port}`);
});
// #endregion dev
