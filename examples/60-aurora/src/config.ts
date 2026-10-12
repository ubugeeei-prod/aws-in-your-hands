import * as v from "valibot";

export const AURORA_STACK = "AihAurora";
export const REGION = "ap-northeast-1";
export const DATABASE_NAME = "notes";

// #region config
const number = v.pipe(
  v.union([v.number(), v.pipe(v.string(), v.transform(Number))]),
  v.number(),
  v.finite(),
);
// ACUs come in half steps.
const halfSteps = v.check(
  (value: number) => Number.isInteger(value * 2),
  "Must be a multiple of 0.5.",
);

const configSchema = v.pipe(
  v.object({
    // The newest 17.x line whose release notes were a few months old on the
    // day this was written. `-c engineVersion=` picks another.
    engineVersion: v.optional(v.pipe(v.string(), v.regex(/^\d+\.\d+$/)), "17.9"),
    // 0 lets the instance pause. 0.5 keeps it awake, and billed, all month.
    minCapacity: v.optional(v.pipe(number, halfSteps, v.minValue(0), v.maxValue(256)), 0),
    maxCapacity: v.optional(v.pipe(number, halfSteps, v.minValue(1), v.maxValue(256)), 1),
    secondsUntilAutoPause: v.optional(
      v.pipe(number, v.integer(), v.minValue(300), v.maxValue(86_400)),
      300,
    ),
    storage: v.optional(v.picklist(["aurora", "aurora-iopt1"]), "aurora"),
  }),
  v.check(
    (config) => config.minCapacity <= config.maxCapacity,
    "minCapacity must not be above maxCapacity.",
  ),
);

export type AuroraConfig = v.InferOutput<typeof configSchema>;

/** Reads `-c name=value` context. A missing value takes the default beside it. */
export function parseAuroraConfig(context: Record<string, unknown>): AuroraConfig {
  const given = Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined),
  );
  const result = v.safeParse(configSchema, given);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid context:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion config
