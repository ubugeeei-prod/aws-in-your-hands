import { describe, expect, it } from "vite-plus/test";

import { toParquet } from "@aih/example-26-analytics/src/columnar.ts";

import { difference, identical } from "../src/compare.ts";
import { curate } from "../src/curate.ts";
import { readCurated } from "../src/parquet.ts";
import { SAMPLE_DAYS, sampleLake } from "../src/sample.ts";

const { records } = sampleLake();
const expected = curate(records, SAMPLE_DAYS[0]);

describe("checking a job's output against the specification", () => {
  it("finds no difference in the same rows read back from Parquet, in another order", async () => {
    // Written by a JavaScript library here. Spark's own files have not been read by this code.
    const read = await readCurated(toParquet(expected.toReversed()));
    expect(identical(difference(expected, read))).toBe(true);
  });

  it("names a row that is missing, one that is doubled, one that changed, one that does not belong", () => {
    const [a, b, c, ...rest] = expected;
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("the sample is too small");
    }
    const stranger = { ...a, event_id: "00000000-0000-4000-8000-000000000000" };
    const found = difference(expected, [b, b, { ...c, status: 500 }, stranger, ...rest]);
    expect(found).toEqual({
      missing: [a.event_id],
      doubled: [b.event_id],
      changed: [c.event_id],
      unexpected: [stranger.event_id],
    });
    expect(identical(found)).toBe(false);
  });
});
