import { parquetReadObjects } from "hyparquet";
import * as v from "valibot";

import { type RequestRecord, requestRecordSchema } from "@aih/example-26-analytics/src/record.ts";

// #region read
/**
 * The rows of one Parquet file, checked against chapter 26's schema: what the
 * job wrote has to be a request record again, not only something with ten columns.
 */
export async function readCurated(file: ArrayBuffer): Promise<RequestRecord[]> {
  const rows = await parquetReadObjects({ file });
  return rows.map((row) =>
    v.parse(
      requestRecordSchema,
      Object.fromEntries(
        Object.entries(row).map(([name, value]) => [
          name,
          // BIGINT comes back as a bigint, and a missing value as undefined.
          typeof value === "bigint" ? Number(value) : (value ?? null),
        ]),
      ),
    ),
  );
}
// #endregion read
