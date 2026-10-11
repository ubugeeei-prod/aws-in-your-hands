import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

export type FunctionValue = { value: string; multiValue?: { value: string }[] };

export type ViewerRequest = {
  method: string;
  uri: string;
  querystring: Record<string, FunctionValue>;
  headers: Record<string, FunctionValue>;
  cookies: Record<string, FunctionValue>;
};

export type ViewerRequestEvent = { version: "1.0"; context: { eventType: "viewer-request" }; request: ViewerRequest };

export type GeneratedResponse = {
  statusCode: number;
  statusDescription?: string;
  headers?: Record<string, FunctionValue>;
  body?: { encoding: "text" | "base64"; data: string };
};

export type ViewerRequestResult = ViewerRequest | GeneratedResponse;

/** What `cf.kvs()` returns, as far as this chapter's function uses it. */
export type KvsStandIn = { get(key: string): Promise<string> };

export const isGeneratedResponse = (result: ViewerRequestResult): result is GeneratedResponse => "statusCode" in result;

// #region load
const KVS_IMPORT = /^import cf from "cloudfront";\n/;

/**
 * Runs the deployed file under Node. The `cloudfront` module exists only at the
 * edge, so its import line is replaced by a `cf` global. Nothing else is changed.
 */
export function loadViewerRequestFunction(
  path: URL | string,
  kvs: KvsStandIn,
): (event: ViewerRequestEvent) => Promise<ViewerRequestResult> {
  const source = readFileSync(path, "utf8");
  if (!KVS_IMPORT.test(source)) {
    throw new Error(`${String(path)} does not start with the cloudfront import this loader replaces`);
  }
  // A fresh context has no fetch, setTimeout, process, or require, much like the real runtime.
  const handler = runInNewContext(`${source.replace(KVS_IMPORT, "")}; handler`, { cf: { kvs: () => kvs } }) as (
    event: ViewerRequestEvent,
  ) => Promise<ViewerRequestResult>;
  // Objects made inside the context belong to another realm; a JSON round trip brings them home.
  return async (event) => JSON.parse(JSON.stringify(await handler(structuredClone(event)))) as ViewerRequestResult;
}
// #endregion load

export function viewerRequest(uri: string, query: Record<string, string> = {}, method = "GET"): ViewerRequestEvent {
  return {
    version: "1.0",
    context: { eventType: "viewer-request" },
    request: {
      method,
      uri,
      querystring: Object.fromEntries(Object.entries(query).map(([key, value]) => [key, { value }])),
      headers: {},
      cookies: {},
    },
  };
}

// #region stand-in
/** Rejects for a missing key, as the real get() does. Counts reads, because reads are billed. */
export function mapKvs(entries: ReadonlyMap<string, string> | (() => ReadonlyMap<string, string>)): KvsStandIn & {
  reads: string[];
} {
  const reads: string[] = [];
  return {
    reads,
    get(key) {
      reads.push(key);
      const value = (typeof entries === "function" ? entries() : entries).get(key);
      return value === undefined ? Promise.reject(new Error(`key not found: ${key}`)) : Promise.resolve(value);
    },
  };
}
// #endregion stand-in
