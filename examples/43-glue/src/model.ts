// A model of job runs for the tests: which files a run reads, what it leaves
// behind, and what a crash in the middle does. It follows what the AWS Glue and
// Spark documentation state. It is not Spark, and not AWS Glue.

import { gunzipSync } from "node:zlib";

import { type LakeObject, scanPartitions } from "@aih/example-26-analytics/src/lake.ts";
import { parseLines, type RequestRecord } from "@aih/example-26-analytics/src/record.ts";

import { curate } from "./curate.ts";
import { arrivalDays, curatedPrefix } from "./layout.ts";
import { evaluate, type Rule, RULES } from "./quality.ts";

// #region design
export type Design = {
  /**
   * false: a run is told which days to build, and reads their raw folders whole.
   * true: a run reads only the raw objects no earlier run has committed, as a job
   * bookmark arranges, and writes to whichever days those objects hold.
   */
  bookmark: boolean;
  /** replace: a day's folder is emptied, then written. append: a file is added to it. */
  sink: "replace" | "append";
};

/** This chapter's job. */
export const RECOMPUTE: Design = { bookmark: false, sink: "replace" };

/** Where a run dies. Spark deletes before it writes; the bookmark is saved last, by job.commit(). */
export type Crash = "after-delete" | "after-write";
// #endregion design

// #region model
export class JobModel {
  /** The curated prefix: object key to the rows in that object. */
  readonly target = new Map<string, RequestRecord[]>();
  readonly #design: Design;
  #committed = new Set<string>();
  #runs = 0;

  constructor(design: Design) {
    this.#design = design;
  }

  /** One run. `days` is what a recomputing job is asked for; a bookmarked one finds its own. */
  run(
    raw: readonly LakeObject[],
    options: { days?: readonly string[]; crash?: Crash; rules?: readonly Rule[] } = {},
  ): void {
    const run = ++this.#runs;
    const fresh = raw.filter((object) => !this.#committed.has(object.key));
    const read = this.#design.bookmark
      ? fresh.flatMap((object) => parseLines(gunzipSync(object.bytes).toString("utf8")))
      : undefined;
    const days =
      read === undefined
        ? (options.days ?? [])
        : [...new Set(read.map((record) => record.at.slice(0, 10)))].toSorted();

    for (const day of days) {
      const rows = curate(read ?? scanPartitions(raw, arrivalDays(day)).records, day);
      if (rows.length === 0) {
        // Nothing to say about this day. What an earlier run wrote for it stays.
        continue;
      }
      const failed = evaluate(options.rules ?? RULES, rows).filter(
        ({ outcome }) => outcome === "Failed",
      );
      if (failed.length > 0) {
        throw new Error(`${day}: ${failed.map(({ rule }) => rule).join("; ")}`);
      }
      const prefix = curatedPrefix(day);
      if (this.#design.sink === "replace") {
        for (const key of [...this.target.keys()].filter((each) => each.startsWith(prefix))) {
          this.target.delete(key);
        }
        if (options.crash === "after-delete") {
          throw new Error("crashed between the delete and the write");
        }
      }
      // Spark names a file after the write that made it, so no two runs share a name.
      this.target.set(`${prefix}part-00000-run${String(run)}.snappy.parquet`, rows);
    }

    if (options.crash === "after-write") {
      throw new Error("crashed before job.commit()");
    }
    // Only sources are remembered. Nothing records what was written, or where.
    for (const object of fresh) {
      this.#committed.add(object.key);
    }
  }

  /** Forgets every committed source, as `aws glue reset-job-bookmark` does. The target is left alone. */
  resetBookmark(): void {
    this.#committed = new Set();
  }

  /** Every row a reader of the day's folder would see. */
  rows(day: string): RequestRecord[] {
    const prefix = curatedPrefix(day);
    return [...this.target].flatMap(([key, rows]) => (key.startsWith(prefix) ? rows : []));
  }
}
// #endregion model
