import * as v from "valibot";

// #region env
const count = (fallback: string, max: number) =>
  v.optional(
    v.pipe(
      v.string(),
      v.regex(/^\d+$/, "use a whole number"),
      v.transform(Number),
      v.number(),
      v.maxValue(max),
    ),
    fallback,
  );

/** What the job reads from its environment. A one-off run overrides these, not the image. */
export const jobEnvSchema = v.object({
  JOB_ITEMS: count("20", 100_000),
  /** Where to resume. An interrupted run logs the number to pass here. */
  JOB_START_AT: count("0", 100_000),
  JOB_ITEM_MS: count("250", 60_000),
  APP_VERSION: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128)), "dev"),
});

export type JobEnv = v.InferOutput<typeof jobEnvSchema>;

export function parseJobEnv(source: Record<string, string | undefined>): JobEnv {
  const result = v.safeParse(jobEnvSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  if (result.output.JOB_START_AT > result.output.JOB_ITEMS) {
    throw new Error("Invalid environment:\n  JOB_START_AT: is past JOB_ITEMS");
  }
  return result.output;
}
// #endregion env

// #region run
/** 0: everything done. 75 (EX_TEMPFAIL): stopped early on purpose; run it again from `next`. */
export const EXIT_CODE = { done: 0, interrupted: 75 } as const;

export type JobResult = { status: keyof typeof EXIT_CODE; next: number; total: number };

export type JobDeps = {
  items: number;
  startAt: number;
  /** One unit of work. The example's unit is a pause; a real job's is one record, one file, one page. */
  work: (item: number) => Promise<void>;
  /** True once SIGTERM has arrived. Checked between items, never in the middle of one. */
  stopRequested: () => boolean;
  log: (entry: Record<string, unknown>) => void;
};

/** Does the items in order, and stops between two of them when asked to. */
export async function runJob(deps: JobDeps): Promise<JobResult> {
  for (let item = deps.startAt; item < deps.items; item += 1) {
    if (deps.stopRequested()) {
      // The checkpoint. Everything before `next` is done; nothing at or after it was started.
      deps.log({ level: "warn", message: "interrupted", next: item, total: deps.items });
      return { status: "interrupted", next: item, total: deps.items };
    }
    await deps.work(item);
    deps.log({ level: "info", message: "item done", item });
  }
  deps.log({ level: "info", message: "done", total: deps.items });
  return { status: "done", next: deps.items, total: deps.items };
}
// #endregion run
