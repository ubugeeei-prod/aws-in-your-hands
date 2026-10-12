import * as v from "valibot";

// #region layout
export const FORMATS = ["json", "parquet"] as const;
export type Format = (typeof FORMATS)[number];

// One folder per format: files of two formats under one table cannot be read together.
export const tableRoot = (format: Format) => `requests_${format}/`;

/** The key prefix Firehose is given. Firehose fills in `!{timestamp:…}`, in UTC. */
export const firehosePrefix = (format: Format) => `${tableRoot(format)}dt=!{timestamp:yyyy-MM-dd}/`;

/** Where records that could not be converted go, by the kind of failure. */
export const FIREHOSE_ERROR_PREFIX =
  "errors/!{firehose:error-output-type}/!{timestamp:yyyy-MM-dd}/";

/** The first day Athena looks for. Earlier days are never listed, whatever a query asks. */
export const FIRST_DAY = "2026-10-01";

/**
 * Table properties that let Athena work out the partitions from the query,
 * so that nobody has to register a new one every midnight.
 */
export function projectionParameters(tableLocation: string): Record<string, string> {
  return {
    "projection.enabled": "true",
    "projection.dt.type": "date",
    "projection.dt.format": "yyyy-MM-dd",
    // NOW is the moment of the query, in UTC: the same clock as the prefix above.
    "projection.dt.range": `${FIRST_DAY},NOW`,
    "projection.dt.interval": "1",
    "projection.dt.interval.unit": "DAYS",
    "storage.location.template": `${tableLocation}dt=\${dt}/`,
  };
}
// #endregion layout

// #region day
/** A calendar day in UTC. v.isoDate() would accept 2026-02-30. */
export const daySchema = v.pipe(
  v.string(),
  v.regex(/^\d{4}-\d{2}-\d{2}$/),
  v.check((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Must be a day that exists, such as 2026-10-12."),
);

export const dayOf = (moment: Date): string => moment.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  const date = new Date(`${v.parse(daySchema, day)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dayOf(date);
}

export function daysBetween(first: string, last: string): string[] {
  const end = v.parse(daySchema, last);
  const days: string[] = [];
  for (let day = v.parse(daySchema, first); day <= end; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}
// #endregion day

// #region evaluate
/**
 * The prefix as Firehose would fill it in for an object whose oldest record
 * arrived at `oldestArrival`. Knows the two expressions this chapter uses and
 * no others.
 */
export function evaluatePrefix(
  prefix: string,
  oldestArrival: Date,
  errorType = "format-conversion-failed",
): string {
  return prefix.replaceAll(/!\{([^:}]*):([^}]*)\}/g, (_whole, namespace: string, value: string) => {
    if (namespace === "timestamp" && value === "yyyy-MM-dd") {
      return dayOf(oldestArrival);
    }
    if (namespace === "firehose" && value === "error-output-type") {
      return errorType;
    }
    throw new Error(`This model does not evaluate !{${namespace}:${value}}`);
  });
}

/** The partition an object key belongs to, or undefined for a key outside the table. */
export function partitionOf(key: string, format: Format): string | undefined {
  const root = tableRoot(format);
  if (!key.startsWith(root)) {
    return undefined;
  }
  return /^dt=(\d{4}-\d{2}-\d{2})\/[^/]+$/.exec(key.slice(root.length))?.[1];
}
// #endregion evaluate
