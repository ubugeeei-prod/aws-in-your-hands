// The two calls to Grafana's HTTP API that publish a dashboard. `fetch` is passed in.

import * as v from "valibot";

import type { Dashboard } from "./schema.ts";

export type GrafanaApi = {
  /** Where the workspace answers: the stack's WorkspaceEndpoint output. */
  endpoint: string;
  /** A service account token. Sent as a Bearer header to that endpoint over HTTPS, and nowhere else. */
  token: string;
  fetch: typeof fetch;
};

// #region call
/**
 * `https://<host>` for a workspace endpoint. The documentation does not say whether the
 * endpoint carries a scheme, so both forms are read. Nothing but a host name is accepted:
 * a path, a port or user info in it would send the token somewhere unexpected.
 */
export function workspaceOrigin(endpoint: string): string {
  const host = endpoint.replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
    throw new Error(`"${endpoint}" is not a host name`);
  }
  return `https://${host}`;
}

async function call(
  api: GrafanaApi,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await api.fetch(`${workspaceOrigin(api.endpoint)}${path}`, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${api.token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    // A redirect would carry the header to wherever it points.
    redirect: "error",
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, json };
}

const messageSchema = v.object({ message: v.string() });

function failure(what: string, status: number, json: unknown): Error {
  const parsed = v.safeParse(messageSchema, json);
  // Grafana's own message, which never contains the token. The request is not echoed.
  return new Error(
    `${what}: HTTP ${String(status)}${parsed.success ? ` (${parsed.output.message})` : ""}`,
  );
}
// #endregion call

// #region datasource
export const DATASOURCE_NAME = "CloudWatch (workspace role)";

const datasourceSchema = v.object({
  uid: v.pipe(v.string(), v.minLength(1)),
  type: v.string(),
});

async function findDataSource(api: GrafanaApi): Promise<string | undefined> {
  const path = `/api/datasources/name/${encodeURIComponent(DATASOURCE_NAME)}`;
  const { status, json } = await call(api, "GET", path);
  if (status === 404) {
    return undefined;
  }
  if (status !== 200) {
    throw failure("could not read the data source", status, json);
  }
  const found = v.parse(datasourceSchema, json);
  if (found.type !== "cloudwatch") {
    throw new Error(`the data source "${DATASOURCE_NAME}" exists and is a ${found.type}`);
  }
  return found.uid;
}

/** The uid of the workspace's CloudWatch data source, created on the first run. */
export async function ensureCloudWatchDataSource(api: GrafanaApi, region: string): Promise<string> {
  const existing = await findDataSource(api);
  if (existing !== undefined) {
    return existing;
  }
  const { status, json } = await call(api, "POST", "/api/datasources", {
    name: DATASOURCE_NAME,
    type: "cloudwatch",
    access: "proxy",
    // "default" is the AWS SDK's own chain, which in a workspace is the workspace role. No keys.
    jsonData: { authType: "default", defaultRegion: region },
  });
  if (status !== 200) {
    throw failure("could not create the data source", status, json);
  }
  const created = await findDataSource(api);
  if (created === undefined) {
    throw new Error("the data source was created and then not found");
  }
  return created;
}
// #endregion datasource

// #region save
const savedSchema = v.object({
  uid: v.string(),
  url: v.string(),
  version: v.number(),
  status: v.literal("success"),
});
export type Saved = v.InferOutput<typeof savedSchema>;

/** Creates the dashboard, or replaces the one with the same uid. */
export async function saveDashboard(
  api: GrafanaApi,
  dashboard: Dashboard,
  message: string,
): Promise<Saved> {
  const { status, json } = await call(api, "POST", "/api/dashboards/db", {
    dashboard,
    message,
    // The repository is the source of truth: whatever the workspace holds under this uid is replaced.
    overwrite: true,
  });
  if (status !== 200) {
    throw failure("could not save the dashboard", status, json);
  }
  const saved = v.parse(savedSchema, json);
  if (saved.uid !== dashboard.uid) {
    throw new Error(`saved under uid ${saved.uid}, expected ${dashboard.uid}`);
  }
  return saved;
}
// #endregion save

// #region token
/** The longest a token may live: 30 days. This chapter asks for far less. */
export const MAX_TOKEN_SECONDS = 2_592_000;
export const TOKEN_SECONDS = 900;

/** The arguments for one short-lived token. The name says when and why it was made. */
export function tokenRequest(now: Date): { name: string; secondsToLive: number } {
  return {
    name: `push-${now.toISOString().replaceAll(/[^0-9TZ]/g, "")}`,
    secondsToLive: TOKEN_SECONDS,
  };
}
// #endregion token
