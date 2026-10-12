import { describe, expect, it } from "vite-plus/test";

import { matches, metricFilterPattern } from "../src/conditions.ts";
import { errorLineSchema, requestLineSchema } from "../src/log-shape.ts";
import {
  byRequestId,
  byTraceId,
  conflictLines,
  type Query,
  renderInsights,
  runLocally,
  serverErrorsByRoute,
  slowRequests,
} from "../src/queries.ts";
import { brokenList, harness, requestIdOf } from "./harness.ts";

async function traffic() {
  const h = harness({ repository: brokenList("table unavailable"), msPerTick: 40 });
  const created = (await (await h.send("POST", "/notes", { title: "first" })).json()) as {
    id: string;
  };
  await h.send("GET", "/notes"); // 500
  await h.send("GET", "/notes"); // 500
  await h.send("GET", "/notes/missing"); // 404
  await h.send("PUT", `/notes/${created.id}`, { title: "stale", body: "", expectedVersion: 9 }); // 409
  return h;
}

describe("Logs Insights queries against real log lines", () => {
  it("finds everything one request wrote, and nothing else", async () => {
    const h = await traffic();
    const rows = runLocally(byRequestId(requestIdOf(2)), h.lines());

    expect(rows.map((row) => row["message"])).toEqual(["unhandled error", "request"]);
    expect(rows[0]?.["error"]).toContain("table unavailable");
    expect(rows[1]).toMatchObject({ method: "GET", path: "/notes", status: 500 });
  });

  it("counts server errors per route and leaves 4xx out", async () => {
    const h = await traffic();
    expect(runLocally(serverErrorsByRoute(), h.lines())).toEqual([
      { method: "GET", path: "/notes", requests: 2 },
    ]);
  });

  it("lists slow requests, slowest first", async () => {
    const h = harness({ msPerTick: 300 });
    await h.send("GET", "/health");
    await h.send("POST", "/notes", { title: "first" });
    const rows = runLocally(slowRequests(300), h.lines());

    const durations = rows.map((row) => row["durationMs"] as number);
    expect(durations).toHaveLength(2);
    expect(durations).toEqual(durations.toSorted((a, b) => b - a));
    expect(runLocally(slowRequests(10_000), h.lines())).toEqual([]);
  });

  it("refers only to fields the log lines have", () => {
    const known = new Set([
      ...Object.keys(requestLineSchema.shape),
      ...Object.keys(errorLineSchema.shape),
    ]);
    const queries: Query[] = [
      byRequestId(requestIdOf(1)),
      byTraceId("0af7651916cd43dd8448eb211c80319c"),
      serverErrorsByRoute(),
      slowRequests(1000),
    ];
    for (const query of queries) {
      const shown = query.show.kind === "fields" ? query.show.fields : query.show.by;
      const sorted = ["@timestamp", "requests"].includes(query.sort.field)
        ? []
        : [query.sort.field];
      for (const field of [
        ...query.where.map((condition) => condition.field),
        ...shown,
        ...sorted,
      ]) {
        expect(known, `field ${field}`).toContain(field);
      }
    }
  });

  it("renders the text that goes to Logs Insights", () => {
    expect(renderInsights(byRequestId(requestIdOf(2)))).toBe(
      [
        'filter requestId = "00000000-0000-4000-8000-000000000002"',
        "| fields @timestamp, level, message, method, path, status, durationMs, traceId, sampled, error",
        "| sort @timestamp asc",
        "| limit 100",
      ].join("\n"),
    );
    expect(renderInsights(serverErrorsByRoute())).toBe(
      [
        'filter message = "request" and status >= 500',
        "| stats count(*) as requests by method, path",
        "| sort requests desc",
        "| limit 20",
      ].join("\n"),
    );
  });

  it("refuses an ID that would change the query", () => {
    expect(() => byRequestId('x" or requestId like "')).toThrow();
    expect(() => byTraceId("1-67891233-abcdef012345678912345678")).toThrow();
  });
});

describe("the metric filter for conflicts", () => {
  it("matches the 409 line and no other", async () => {
    const h = await traffic();
    const matched = h.lines().filter((line) => matches(conflictLines, line));
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ method: "PUT", status: 409 });
  });

  it("renders as a JSON filter pattern", () => {
    expect(metricFilterPattern(conflictLines)).toBe(
      '{ ($.message = "request") && ($.status = 409) }',
    );
    expect(metricFilterPattern([{ field: "level", op: "=", value: "error" }])).toBe(
      '{ $.level = "error" }',
    );
  });

  it("refuses a value that could close the quotes", () => {
    expect(() => metricFilterPattern([{ field: "message", op: "=", value: 'a" }' }])).toThrow();
    expect(() => metricFilterPattern([{ field: "$.x || $.y", op: "=", value: 1 }])).toThrow();
  });
});
