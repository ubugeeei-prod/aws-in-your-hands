import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import {
  compactDays,
  createCompactTable,
  createIcebergTable,
  eventsPerDayYesterday,
  mergeDays,
  optimizeDays,
  requestsForRoute,
  routeSchema,
  scratchErrors,
  unloadDays,
  unsafeRequestsForRoute,
  vacuum,
} from "../src/queries.ts";
import { trusted } from "../src/statement.ts";

const day = { from: "2026-10-12", to: "2026-10-12" };
const HOSTILE = "/notes' OR '1'='1";

describe("the injection", () => {
  it("changes the query when the route is pasted into the text", () => {
    const honest = unsafeRequestsForRoute({ ...day, route: "/notes" });
    const attacked = unsafeRequestsForRoute({ ...day, route: HOSTILE });
    // The quote in the value closed the literal, and what follows it is now SQL.
    expect(attacked).toContain("route = '/notes' OR '1'='1'");
    expect(attacked.replace(HOSTILE, "/notes")).toBe(honest);
  });

  it("cannot change the query when the route is a parameter: the text is the same for any value", () => {
    const honest = requestsForRoute({ ...day, route: "/notes" });
    const attacked = requestsForRoute({ ...day, route: HOSTILE });
    expect(attacked.sql).toBe(honest.sql);
    expect(attacked.sql).not.toContain(" OR ");
    expect(attacked.parameters.at(-1)).toBe("'/notes'' OR ''1''=''1'");
  });

  it("is refused earlier still by the list of routes", () => {
    expect(v.safeParse(routeSchema, HOSTILE).success).toBe(false);
    expect(v.safeParse(routeSchema, "/notes/:id").success).toBe(true);
  });
});

describe("the route query", () => {
  it("names its folders first, one day wider than the range, and passes every value as a parameter", () => {
    const statement = requestsForRoute({ from: "2026-10-12", to: "2026-10-13", route: "/notes" });
    expect(statement.sql).toBe(
      [
        "SELECT status, count(DISTINCT event_id) AS requests",
        "FROM aih_analytics.requests",
        "WHERE dt BETWEEN ? AND ?",
        "  AND at >= ?",
        "  AND at < ?",
        "  AND route = ?",
        "GROUP BY status",
        "ORDER BY status",
      ].join("\n"),
    );
    expect(statement.parameters).toEqual([
      "'2026-10-11'",
      "'2026-10-14'",
      "'2026-10-12T00:00:00.000Z'",
      "'2026-10-14T00:00:00.000Z'",
      "'/notes'",
    ]);
  });

  it("refuses a day that does not exist and a range that runs backwards", () => {
    expect(() =>
      requestsForRoute({ from: "2026-02-30", to: "2026-03-01", route: "/notes" }),
    ).toThrow();
    expect(() =>
      requestsForRoute({ from: "2026-10-13", to: "2026-10-12", route: "/notes" }),
    ).toThrow(/ends before it starts/);
  });
});

describe("statements that write", () => {
  const tables = trusted("s3://amzn-s3-demo-bucket/tables/requests_compact/");

  it("defines the Parquet table with the record's columns and the folder as its partition", () => {
    const { sql, parameters } = createCompactTable(tables);
    expect(parameters).toEqual([]);
    expect(sql).toContain("CREATE EXTERNAL TABLE IF NOT EXISTS aih_analytics.requests_compact (");
    expect(sql).toContain("`event_id` string");
    expect(sql).toContain("`duration_ms` bigint");
    expect(sql).toContain("PARTITIONED BY (`dt` string)\nSTORED AS PARQUET");
    expect(sql).toContain("LOCATION 's3://amzn-s3-demo-bucket/tables/requests_compact/'");
    // A partition column is not also a data column.
    expect(sql.match(/`dt`/g)).toHaveLength(1);
  });

  it("copies one row per event, with the partition column last", () => {
    const { sql, parameters } = compactDays(day);
    expect(sql.startsWith("INSERT INTO aih_analytics.requests_compact\nSELECT v, event_id,")).toBe(
      true,
    );
    expect(sql).toContain("note_id, min(dt) AS dt\nFROM aih_analytics.requests");
    expect(sql).toContain("GROUP BY v, event_id,");
    expect(parameters).toEqual(["'2026-10-12'", "'2026-10-12'"]);
  });

  it("builds the scratch table without a location, so it lands where the workgroup says", () => {
    const { sql, parameters } = scratchErrors(day);
    expect(sql).toContain(
      "CREATE TABLE aih_analytics.scratch_errors\nWITH (format = 'PARQUET') AS",
    );
    expect(sql).not.toContain("external_location");
    expect(parameters.at(-1)).toBe("500");
  });

  it("unloads into a folder named by the run, and refuses a name that could leave it", () => {
    const exports = trusted("s3://amzn-s3-demo-bucket/exports/");
    expect(unloadDays(day, exports, "october-12").sql).toContain(
      "TO 's3://amzn-s3-demo-bucket/exports/october-12/'\nWITH (format = 'PARQUET')",
    );
    for (const name of ["../tables", "a/b", "x'", ""]) {
      expect(() => unloadDays(day, exports, name)).toThrow(/Not a name/);
    }
  });
});

describe("the Iceberg statements", () => {
  it("creates a table that is not EXTERNAL, partitioned by a column it declares", () => {
    const { sql } = createIcebergTable(
      trusted("s3://amzn-s3-demo-bucket/tables/requests_iceberg/"),
    );
    expect(sql.startsWith("CREATE TABLE aih_analytics.requests_iceberg (")).toBe(true);
    expect(sql).not.toContain("EXTERNAL");
    expect(sql).toContain("`dt` string\n)\nPARTITIONED BY (`dt`)");
    expect(sql).toContain("TBLPROPERTIES ('table_type' = 'ICEBERG', 'format' = 'parquet')");
  });

  it("merges on the event ID and only ever inserts, so a second run changes nothing", () => {
    const { sql, parameters } = mergeDays(day);
    expect(parameters).toEqual([]);
    expect(sql).toContain("ON t.event_id = s.event_id\nWHEN NOT MATCHED\n  THEN INSERT (");
    expect(sql).not.toContain("WHEN MATCHED");
    expect(sql).toContain("WHERE dt BETWEEN '2026-10-12' AND '2026-10-12'");
    expect(sql).toContain("VALUES (s.v, s.event_id,");
  });

  it("puts only checked days into the text of statements that take no parameters", () => {
    for (const build of [mergeDays, optimizeDays]) {
      expect(() => build({ from: "2026-10-12' OR '1'='1", to: "2026-10-12" })).toThrow();
      expect(() => build({ from: "2026-13-01", to: "2026-13-02" })).toThrow();
    }
  });

  it("optimizes by the partition column only", () => {
    expect(optimizeDays(day).sql).toBe(
      "OPTIMIZE aih_analytics.requests_iceberg REWRITE DATA USING BIN_PACK\nWHERE dt BETWEEN '2026-10-12' AND '2026-10-12'",
    );
  });

  it("vacuums and travels in time with the documented spellings", () => {
    expect(vacuum().sql).toBe("VACUUM aih_analytics.requests_iceberg");
    expect(eventsPerDayYesterday().sql).toContain(
      "FROM aih_analytics.requests_iceberg FOR TIMESTAMP AS OF (current_timestamp - interval '1' day)",
    );
  });
});
