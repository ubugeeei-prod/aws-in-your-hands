import { parquetMetadata, parquetReadObjects } from "hyparquet";
import { describe, expect, it } from "vite-plus/test";

import { columnBytes, columnsOf, toGzipJson, toParquet } from "../src/columnar.ts";
import { actionsPerDay, errorsPerDay, requestsPerRoute, statusPerDay } from "../src/queries.ts";
import { sampleRecords } from "../src/sample.ts";

const records = sampleRecords(5000, "2026-10-12");
const parquet = toParquet(records);
const sizes = columnBytes(parquet);
const sum = (names: readonly (keyof typeof sizes)[]) =>
  names.reduce((total, name) => total + sizes[name], 0);

describe("the same records as a Parquet file", () => {
  it("holds every record, with nulls where there was no action", async () => {
    expect(Number(parquetMetadata(parquet).num_rows)).toBe(records.length);
    const rows = await parquetReadObjects({ file: parquet, rowEnd: 50 });
    expect(rows.map((row) => ({ ...row, duration_ms: Number(row["duration_ms"]) }))).toEqual(
      records.slice(0, 50),
    );
  });

  it("stores each column apart, so a query's columns are a part of the file", () => {
    for (const query of [
      actionsPerDay("2026-10-12", "2026-10-12"),
      requestsPerRoute("2026-10-12", "2026-10-12"),
      errorsPerDay("2026-10-12", "2026-10-12"),
    ]) {
      expect(sum(columnsOf(query))).toBeLessThan(parquet.byteLength);
    }
    expect(columnsOf(requestsPerRoute("2026-10-12", "2026-10-12"))).toEqual([
      "event_id",
      "at",
      "method",
      "route",
      "duration_ms",
    ]);
  });

  it("spends most of its bytes on the two columns of random IDs", () => {
    const ids = sizes.event_id + sizes.request_id;
    expect(ids).toBeGreaterThan(parquet.byteLength / 2);
    // A query that needs neither ID reads a small share of the file.
    const status = statusPerDay("2026-10-12", "2026-10-12");
    expect(columnsOf(status)).toEqual(["at", "status"]);
    expect(sum(columnsOf(status))).toBeLessThan(parquet.byteLength / 10);
    // Counting each event once means reading its ID: about half the file.
    expect(sum(columnsOf(actionsPerDay("2026-10-12", "2026-10-12")))).toBeGreaterThan(
      parquet.byteLength / 3,
    );
  });

  it("is a different size from the gzip file a query has to read whole", () => {
    expect(toGzipJson(records).byteLength).not.toBe(parquet.byteLength);
  });
});
