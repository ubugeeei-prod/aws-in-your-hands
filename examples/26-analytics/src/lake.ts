import { gunzipSync, gzipSync } from "node:zlib";

import { evaluatePrefix, firehosePrefix, partitionOf } from "./partition.ts";
import { parseLines, type RequestRecord } from "./record.ts";

export type LakeObject = { key: string; bytes: Uint8Array };

// #region delivery
/**
 * A stand-in for a Firehose stream that delivers gzip-compressed JSON. It keeps
 * what matters to a query: which records share an object, and which day the
 * object is filed under. Buffering by size, retries, and the 24 hours Firehose
 * keeps undelivered data are not modelled.
 */
export class LocalDelivery {
  readonly objects: LakeObject[] = [];
  #lines: string[] = [];
  #oldestArrival: Date | undefined;
  #sequence = 0;

  /** A record arrives. Nothing is written until the buffer is flushed. */
  put(line: string, arrivedAt: Date): void {
    this.#oldestArrival ??= arrivedAt;
    this.#lines.push(line);
  }

  /** The buffer becomes one object, filed under the day its oldest record arrived. */
  flush(): LakeObject | undefined {
    if (this.#oldestArrival === undefined) {
      return undefined;
    }
    const prefix = evaluatePrefix(firehosePrefix("json"), this.#oldestArrival);
    const stamp = this.#oldestArrival.toISOString().slice(0, 19).replaceAll(/[T:]/g, "-");
    // Firehose's own names end in a random ID. A counter keeps local runs repeatable.
    const name = `local-1-${stamp}-${String(++this.#sequence).padStart(6, "0")}.gz`;
    // Records are joined with nothing between them. The newline is the producer's.
    const object = { key: `${prefix}${name}`, bytes: gzipSync(this.#lines.join("")) };
    this.objects.push(object);
    this.#lines = [];
    this.#oldestArrival = undefined;
    return object;
  }
}
// #endregion delivery

// #region scan
export type Scan = {
  records: RequestRecord[];
  partitions: string[];
  objects: number;
  bytes: number;
};

/**
 * Reads every object of the given partitions, whole. A gzip file of JSON lines
 * cannot be opened at one column or one row.
 */
export function scanPartitions(
  objects: readonly LakeObject[],
  partitions: readonly string[],
): Scan {
  const wanted = new Set(partitions);
  const read = objects.flatMap((object) => {
    const partition = partitionOf(object.key, "json");
    return partition !== undefined && wanted.has(partition) ? [{ object, partition }] : [];
  });
  return {
    records: read.flatMap(({ object }) => parseLines(gunzipSync(object.bytes).toString("utf8"))),
    partitions: [...new Set(read.map(({ partition }) => partition))].toSorted(),
    objects: read.length,
    bytes: read.reduce((sum, { object }) => sum + object.bytes.byteLength, 0),
  };
}
// #endregion scan
