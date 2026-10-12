import { describe, expect, it } from "vite-plus/test";

import { scanPartitions } from "../src/lake.ts";
import { daysBetween } from "../src/partition.ts";
import {
  actionsPerDay,
  errorsPerDay,
  partitionsFor,
  type Query,
  renderAthena,
  requestsPerRoute,
  runLocally,
  statusPerDay,
} from "../src/queries.ts";
import { COLUMNS } from "../src/record.ts";
import type { Sink } from "../src/sink.ts";
import { harness } from "./harness.ts";

const TABLE = '"aih_analytics"."requests"';

describe("a record near midnight", () => {
  // Firehose names the folder after the oldest record in the object. This
  // object's oldest record arrived on the 12th; its second is from the 13th.
  async function acrossMidnight() {
    const h = harness();
    h.at("2026-10-12T23:59:50.000Z");
    await h.send("POST", "/notes", { title: "late on the 12th" });
    h.at("2026-10-13T00:00:05.000Z");
    await h.send("POST", "/notes", { title: "early on the 13th" });
    h.delivery.flush();
    return h;
  }

  it("is filed under the day before it happened", async () => {
    const h = await acrossMidnight();
    expect(h.delivery.objects.map((object) => object.key)).toEqual([
      "requests_json/dt=2026-10-12/local-1-2026-10-12-23-59-50-000001.gz",
    ]);
    expect(h.records().map((record) => record.at.slice(0, 10))).toEqual([
      "2026-10-12",
      "2026-10-13",
    ]);
  });

  it("is missed by a query that reads only the folder of its day", async () => {
    const h = await acrossMidnight();
    const naive = scanPartitions(h.delivery.objects, daysBetween("2026-10-13", "2026-10-13"));
    expect(naive.records).toEqual([]);
  });

  it("is found by the queries here, which read one day more on each side", async () => {
    const h = await acrossMidnight();
    expect(partitionsFor({ from: "2026-10-13", to: "2026-10-13" })).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ]);
    expect(runLocally(actionsPerDay("2026-10-13", "2026-10-13"), h.delivery.objects).rows).toEqual([
      { day: "2026-10-13", action: "note_created", events: 1 },
    ]);
    // And the record from the 12th is not counted on the 13th, though it shares the object.
    expect(runLocally(actionsPerDay("2026-10-12", "2026-10-12"), h.delivery.objects).rows).toEqual([
      { day: "2026-10-12", action: "note_created", events: 1 },
    ]);
  });
});

describe("a record written twice", () => {
  // The producer's answer is lost, so it sends again. Firehose has both copies.
  const twice =
    (inner: Sink): Sink =>
    async (line) => {
      await inner(line);
      await inner(line);
    };

  it("is in the bucket twice, and counted once", async () => {
    const h = harness({ sink: twice });
    await h.send("POST", "/notes", { title: "first" });
    await h.send("GET", "/notes");
    h.delivery.flush();

    expect(h.records()).toHaveLength(4);
    // The count that removes no copies sees both.
    expect(runLocally(statusPerDay("2026-10-12", "2026-10-12"), h.delivery.objects).rows).toEqual([
      { day: "2026-10-12", status: 200, answers: 2 },
      { day: "2026-10-12", status: 201, answers: 2 },
    ]);
    expect(runLocally(actionsPerDay("2026-10-12", "2026-10-12"), h.delivery.objects).rows).toEqual([
      { day: "2026-10-12", action: "note_created", events: 1 },
    ]);
    expect(
      runLocally(requestsPerRoute("2026-10-12", "2026-10-12"), h.delivery.objects).rows,
    ).toEqual([
      { method: "GET", route: "/notes", requests: 1, p95_ms: 7 },
      { method: "POST", route: "/notes", requests: 1, p95_ms: 7 },
    ]);
  });
});

describe("what a query reads", () => {
  async function threeDays() {
    const h = harness();
    for (const day of ["2026-10-10", "2026-10-12", "2026-10-20"]) {
      h.at(`${day}T12:00:00.000Z`);
      await h.send("GET", "/notes");
      await h.send("GET", "/nowhere");
      h.delivery.flush();
    }
    return h.delivery.objects;
  }

  it("reads only the objects of the days around its range", async () => {
    const objects = await threeDays();
    const all = objects.reduce((sum, object) => sum + object.bytes.byteLength, 0);
    const one = runLocally(requestsPerRoute("2026-10-12", "2026-10-12"), objects);

    expect(one.partitions).toEqual(["2026-10-12"]);
    expect(one.objects).toBe(1);
    expect(one.bytes).toBeLessThan(all);
    expect(runLocally(requestsPerRoute("2026-10-09", "2026-10-21"), objects).bytes).toBe(all);
  });

  it("counts the errors of a day per route, and nothing below 500", async () => {
    const objects = await threeDays();
    expect(runLocally(errorsPerDay("2026-10-01", "2026-10-31"), objects).rows).toEqual([]);
    expect(runLocally(requestsPerRoute("2026-10-12", "2026-10-12"), objects).rows).toEqual([
      { method: "GET", route: "/notes", requests: 1, p95_ms: 7 },
      { method: "GET", route: "other", requests: 1, p95_ms: 7 },
    ]);
  });
});

describe("the SQL sent to Athena", () => {
  it("bounds the partition column first, one day wider than the days asked for", () => {
    expect(renderAthena(actionsPerDay("2026-10-12", "2026-10-13"), TABLE)).toBe(
      [
        "SELECT substr(at, 1, 10) AS day, action, count(DISTINCT event_id) AS events",
        'FROM "aih_analytics"."requests"',
        "WHERE dt BETWEEN '2026-10-11' AND '2026-10-14'",
        "  AND at >= '2026-10-12T00:00:00.000Z'",
        "  AND at < '2026-10-14T00:00:00.000Z'",
        "  AND action IS NOT NULL",
        "GROUP BY substr(at, 1, 10), action",
        "ORDER BY day, action",
      ].join("\n"),
    );
    expect(renderAthena(requestsPerRoute("2026-10-12", "2026-10-12"), TABLE)).toBe(
      [
        "SELECT method, route, count(DISTINCT event_id) AS requests, approx_percentile(duration_ms, 0.95) AS p95_ms",
        'FROM "aih_analytics"."requests"',
        "WHERE dt BETWEEN '2026-10-11' AND '2026-10-13'",
        "  AND at >= '2026-10-12T00:00:00.000Z'",
        "  AND at < '2026-10-13T00:00:00.000Z'",
        "GROUP BY method, route",
        "ORDER BY method, route",
      ].join("\n"),
    );
    expect(renderAthena(errorsPerDay("2026-10-12", "2026-10-12"), TABLE)).toContain(
      "  AND status >= 500\n",
    );
    expect(renderAthena(statusPerDay("2026-10-12", "2026-10-12"), TABLE)).toContain(
      "SELECT substr(at, 1, 10) AS day, status, count(*) AS answers\n",
    );
  });

  it("cannot be written without a range of days", () => {
    for (const [from, to] of [
      ["2026-10-13", "2026-10-12"],
      ["2026-02-30", "2026-03-01"],
      ["2026-10-12' OR '1'='1", "2026-10-12"],
      ["", ""],
    ] as const) {
      expect(() => renderAthena(actionsPerDay(from, to), TABLE)).toThrow();
    }
  });

  it("refuses a value or a name that would change the query", () => {
    const base = requestsPerRoute("2026-10-12", "2026-10-12");
    const broken: Query[] = [
      { ...base, where: [{ column: "method", op: "=", value: "GET' OR '1'='1" }] },
      { ...base, where: [{ column: "status", op: ">=", value: Number.NaN }] },
      { ...base, where: [{ column: "status; DROP TABLE x" as "status", op: "=", value: 1 }] },
      { ...base, by: ["route, (SELECT 1)" as "route"] },
      { ...base, measures: [{ kind: "distinct", as: "n FROM x --" }] },
      // A result column named like a table column would make ORDER BY ambiguous.
      { ...base, measures: [{ kind: "distinct", as: "status" }] },
    ];
    for (const query of broken) {
      expect(() => renderAthena(query, TABLE)).toThrow();
    }
  });

  it("refers only to columns the table has", () => {
    const known = new Set<string>([...COLUMNS.map((column) => column.name), "day"]);
    for (const query of [
      actionsPerDay("2026-10-12", "2026-10-12"),
      requestsPerRoute("2026-10-12", "2026-10-12"),
      errorsPerDay("2026-10-12", "2026-10-12"),
      statusPerDay("2026-10-12", "2026-10-12"),
    ]) {
      for (const name of [...query.by, ...query.where.map((predicate) => predicate.column)]) {
        expect(known, name).toContain(name);
      }
    }
  });
});
