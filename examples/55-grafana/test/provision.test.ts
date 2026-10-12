import { describe, expect, it } from "vite-plus/test";

import { grafanaDashboard } from "../src/grafana.ts";
import {
  DATASOURCE_NAME,
  ensureCloudWatchDataSource,
  type GrafanaApi,
  MAX_TOKEN_SECONDS,
  saveDashboard,
  tokenRequest,
  workspaceOrigin,
} from "../src/provision.ts";
import { rows } from "../src/signals.ts";
import { REGION } from "./harness.ts";

const TOKEN = "glsa_example_not_a_real_token";
const ENDPOINT = "g-0123456789.grafana-workspace.ap-northeast-1.amazonaws.com";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
type Answer = { status: number; body: unknown };

/** A stand-in for the workspace: answers in the order given and records what it was sent. */
function workspace(answers: Answer[], endpoint = ENDPOINT): { api: GrafanaApi; calls: Call[] } {
  const calls: Call[] = [];
  const fake: typeof fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: init?.headers as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    expect(init?.redirect).toBe("error");
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error("no answer left");
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  return { api: { endpoint, token: TOKEN, fetch: fake }, calls };
}

const dashboard = grafanaDashboard(rows, {
  resources: { api: "a1b2c3", function: "fn", table: "notes" },
  region: REGION,
  datasourceUid: "cw-uid",
});
const namePath = `/api/datasources/name/${encodeURIComponent(DATASOURCE_NAME)}`;

describe("the data source", () => {
  it("is reused when it exists", async () => {
    const { api, calls } = workspace([
      { status: 200, body: { uid: "cw-uid", type: "cloudwatch" } },
    ]);
    expect(await ensureCloudWatchDataSource(api, REGION)).toBe("cw-uid");
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", `https://${ENDPOINT}${namePath}`],
    ]);
  });

  it("is created once, without keys, and then read back for its uid", async () => {
    const { api, calls } = workspace([
      { status: 404, body: { message: "Data source not found" } },
      { status: 200, body: { message: "Datasource added" } },
      { status: 200, body: { uid: "new-uid", type: "cloudwatch" } },
    ]);
    expect(await ensureCloudWatchDataSource(api, REGION)).toBe("new-uid");
    expect(calls[1]).toMatchObject({
      method: "POST",
      url: `https://${ENDPOINT}/api/datasources`,
      body: {
        name: DATASOURCE_NAME,
        type: "cloudwatch",
        jsonData: { authType: "default", defaultRegion: REGION },
      },
    });
    // The workspace role is the credential. No access key travels to Grafana.
    expect(JSON.stringify(calls[1]?.body)).not.toMatch(/secureJsonData|accessKey|secretKey/);
  });

  it("is not taken over when the name belongs to another kind of source", async () => {
    const { api } = workspace([{ status: 200, body: { uid: "x", type: "prometheus" } }]);
    await expect(ensureCloudWatchDataSource(api, REGION)).rejects.toThrow(/is a prometheus/);
  });

  it("stops when the token may not add data sources", async () => {
    const { api, calls } = workspace([
      { status: 404, body: {} },
      { status: 403, body: { message: "Permission denied" } },
    ]);
    await expect(ensureCloudWatchDataSource(api, REGION)).rejects.toThrow(
      "could not create the data source: HTTP 403 (Permission denied)",
    );
    expect(calls).toHaveLength(2);
  });
});

describe("saving the dashboard", () => {
  const saved = {
    id: 7,
    uid: dashboard.uid,
    url: "/d/aih-notes-api/notes-api",
    status: "success",
    version: 3,
  };

  it("replaces whatever the workspace holds under the uid", async () => {
    const { api, calls } = workspace([{ status: 200, body: saved }]);
    expect(await saveDashboard(api, dashboard, "from a test")).toMatchObject({ version: 3 });
    expect(calls[0]).toMatchObject({
      method: "POST",
      url: `https://${ENDPOINT}/api/dashboards/db`,
      body: {
        overwrite: true,
        message: "from a test",
        dashboard: { uid: dashboard.uid, id: null },
      },
    });
  });

  it("sends the token as a Bearer header and nowhere else", async () => {
    const { api, calls } = workspace([{ status: 200, body: saved }]);
    await saveDashboard(api, dashboard, "m");
    expect(calls[0]?.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect(JSON.stringify(calls[0]?.body)).not.toContain(TOKEN);
  });

  for (const [status, body, message] of [
    [401, { message: "Unauthorized" }, "HTTP 401 (Unauthorized)"],
    [
      412,
      { message: "The dashboard has been changed by someone else", status: "version-mismatch" },
      "HTTP 412",
    ],
    [502, "<html>bad gateway</html>", "HTTP 502"],
  ] as const) {
    it(`reports a ${String(status)} without repeating the token`, async () => {
      const { api } = workspace([{ status, body }]);
      const error = await saveDashboard(api, dashboard, "m").catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(message);
      expect((error as Error).message).not.toContain(TOKEN);
    });
  }

  it("does not trust a 200 that saved something else", async () => {
    const { api } = workspace([{ status: 200, body: { ...saved, uid: "another" } }]);
    await expect(saveDashboard(api, dashboard, "m")).rejects.toThrow(/saved under uid another/);
  });
});

describe("where the token may go", () => {
  it("accepts the endpoint with or without the scheme", () => {
    expect(workspaceOrigin(ENDPOINT)).toBe(`https://${ENDPOINT}`);
    expect(workspaceOrigin(`https://${ENDPOINT}/`)).toBe(`https://${ENDPOINT}`);
  });

  for (const endpoint of [
    `http://${ENDPOINT}`,
    `${ENDPOINT}/api@evil.example`,
    `user:pass@${ENDPOINT}`,
    `${ENDPOINT}:8443`,
    `${ENDPOINT}#x`,
    "localhost",
    "",
  ]) {
    it(`sends nothing to "${endpoint}"`, async () => {
      const { api, calls } = workspace([], endpoint);
      await expect(saveDashboard(api, dashboard, "m")).rejects.toThrow(/is not a host name/);
      expect(calls).toHaveLength(0);
    });
  }
});

describe("the token request", () => {
  it("asks for fifteen minutes, far under the 30 days allowed", () => {
    const request = tokenRequest(new Date("2026-10-13T01:02:03.456Z"));
    expect(request).toEqual({ name: "push-20261013T010203456Z", secondsToLive: 900 });
    expect(request.secondsToLive).toBeLessThanOrEqual(MAX_TOKEN_SECONDS);
    expect(request.name.length).toBeLessThanOrEqual(128);
  });
});
