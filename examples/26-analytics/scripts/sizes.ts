// vp run analytics:sizes
//   node scripts/sizes.ts [--records 5000]
//
// Writes the same made-up records as gzip JSON and as Parquet, in memory, and
// prints how many bytes each of the chapter's queries would have to read.
// Local only. The Parquet file is written by a JavaScript library, not by Firehose.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { columnBytes, columnsOf, toGzipJson, toParquet } from "../src/columnar.ts";
import { actionsPerDay, errorsPerDay, requestsPerRoute, statusPerDay } from "../src/queries.ts";
import { toLine } from "../src/record.ts";
import { sampleRecords } from "../src/sample.ts";

const { values } = parseArgs({ options: { records: { type: "string", default: "5000" } } });
const count = v.parse(
  v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
  values.records,
);

const day = "2026-10-12";
const records = sampleRecords(count, day);
const raw = records.reduce((sum, record) => sum + Buffer.byteLength(toLine(record)), 0);
const gzip = toGzipJson(records).byteLength;
const parquet = toParquet(records);
const sizes = columnBytes(parquet);

console.log(`${String(count)} sample records`);
console.log(
  `JSON lines, uncompressed: ${String(raw)} bytes (${(raw / count).toFixed(0)} per record)`,
);
console.log(`JSON lines, gzip:         ${String(gzip)} bytes`);
console.log(`Parquet, Snappy:          ${String(parquet.byteLength)} bytes`);
console.log("\nbytes per column in the Parquet file:");
console.table(sizes);
console.log("bytes a query has to read:");
console.table(
  Object.fromEntries(
    (
      [
        ["actions", actionsPerDay(day, day)],
        ["routes", requestsPerRoute(day, day)],
        ["errors", errorsPerDay(day, day)],
        ["status", statusPerDay(day, day)],
      ] as const
    ).map(([name, query]) => {
      const columns = columnsOf(query);
      return [
        name,
        {
          columns: columns.join(", "),
          "gzip JSON (whole file)": gzip,
          "Parquet (its columns)": columns.reduce((sum, column) => sum + sizes[column], 0),
        },
      ];
    }),
  ),
);
