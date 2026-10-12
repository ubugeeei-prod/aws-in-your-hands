import { gzipSync } from "node:zlib";

import { parquetMetadata } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";

import type { Query } from "./queries.ts";
import { type Column, COLUMNS, type RequestRecord, toLine } from "./record.ts";

// #region write
const PARQUET_TYPE = { int: "INT32", bigint: "INT64", string: "STRING" } as const;

/**
 * The records as one Parquet file, Snappy-compressed, written by a JavaScript
 * library on this machine. Firehose writes its own files with its own writer:
 * the sizes here show the shape of the difference, not Firehose's numbers.
 */
export function toParquet(records: readonly RequestRecord[]): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: COLUMNS.map(({ name, type }) => ({
      name,
      type: PARQUET_TYPE[type],
      nullable: name === "action" || name === "note_id",
      data: records.map((record) => {
        const value = record[name];
        return type === "bigint" && typeof value === "number" ? BigInt(value) : value;
      }),
    })),
  });
}

export const toGzipJson = (records: readonly RequestRecord[]): Uint8Array =>
  gzipSync(records.map(toLine).join(""));
// #endregion write

// #region measure
/** Compressed bytes each column occupies in the file, from the file's own footer. */
export function columnBytes(parquet: ArrayBuffer): Record<Column, number> {
  const sizes = Object.fromEntries(COLUMNS.map(({ name }) => [name, 0])) as Record<Column, number>;
  for (const group of parquetMetadata(parquet).row_groups) {
    for (const chunk of group.columns) {
      const name = chunk.meta_data?.path_in_schema[0] as Column | undefined;
      if (name !== undefined && name in sizes) {
        sizes[name] += Number(chunk.meta_data?.total_compressed_size ?? 0);
      }
    }
  }
  return sizes;
}

/** The columns a query has to read. `dt` is not among them: it is in the key, not in the file. */
export function columnsOf(query: Query): Column[] {
  const used = new Set<Column>(["at"]);
  for (const predicate of query.where) {
    used.add(predicate.column);
  }
  for (const name of query.by) {
    used.add(name === "day" ? "at" : name);
  }
  for (const measure of query.measures) {
    if (measure.kind !== "rows") {
      used.add(measure.kind === "distinct" ? "event_id" : measure.column);
    }
  }
  return COLUMNS.map(({ name }) => name).filter((name) => used.has(name));
}
// #endregion measure
