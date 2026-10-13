import * as v from "valibot";

// #region limits
// The ranges are the ones in the Lambda developer guide's quota tables for Web Functions.
const rateLimit = v.pipe(
  v.number(),
  v.integer(),
  v.check(
    (value) =>
      value === 0 ||
      (value >= 100 && value <= 1000 && value % 100 === 0) ||
      (value >= 2000 && value <= 10_000 && value % 1000 === 0),
    "rateLimit is 0, 100 to 1000 in steps of 100, or 2000 to 10000 in steps of 1000.",
  ),
);

export const limitsSchema = v.object({
  /** Requests per second the endpoint accepts. Beyond it: 429. Zero: every request gets 503. */
  rateLimit,
  /** Execution environments the endpoint may run at once. Two is the lowest value accepted. */
  maxEnvironments: v.pipe(v.number(), v.integer(), v.minValue(2), v.maxValue(10_000)),
  /** Requests one environment answers at once. Lambda may choose fewer, never more. */
  maxConcurrencyPerEnvironment: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(128)),
  /** How long one request may run, streaming included. */
  timeoutSeconds: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(900)),
});

export type Limits = v.InferOutput<typeof limitsSchema>;

/** The most requests in flight at once: every environment running, each one full. */
export const peakConcurrency = (limits: Limits): number =>
  limits.maxEnvironments * limits.maxConcurrencyPerEnvironment;
// #endregion limits

// #region release
// An S3 version ID is opaque. All that is checked is that one was pasted, whole.
const versionId = v.pipe(v.string(), v.regex(/^\S{1,1024}$/, "Must be an S3 object version ID."));

const releaseSchema = v.pipe(
  v.object({
    /** The upload that answers when nothing is being tried out. */
    stable: versionId,
    /** A second upload that takes a share of the requests. */
    canary: v.optional(versionId),
    canaryWeight: v.optional(
      v.pipe(
        v.string(),
        v.regex(/^\d{1,2}$/, "canaryWeight is a whole number from 1 to 99."),
        v.transform(Number),
        v.minValue(1),
      ),
    ),
  }),
  v.check(
    (release) => (release.canary === undefined) === (release.canaryWeight === undefined),
    "canary and canaryWeight go together.",
  ),
  v.check((release) => release.canary !== release.stable, "canary is the same upload as stable."),
);

export type Release = v.InferOutput<typeof releaseSchema>;

/** `-c stable=... [-c canary=... -c canaryWeight=10]`. Without `stable`, no code has been uploaded yet. */
export function parseRelease(context: (key: string) => unknown): Release | undefined {
  const given = {
    stable: context("stable"),
    canary: context("canary"),
    canaryWeight: context("canaryWeight"),
  };
  if (Object.values(given).every((value) => value === undefined)) {
    return undefined;
  }
  const result = v.safeParse(releaseSchema, given);
  if (!result.success) {
    throw new Error(
      `Invalid release: ${result.issues.map((issue) => `${v.getDotPath(issue) ?? "release"}: ${issue.message}`).join(" ")}`,
    );
  }
  return result.output;
}
// #endregion release

// #region weights
export type Share = { version: string; weight: number };

/** One or two entries, whole numbers from 1 to 100, adding up to 100: what an endpoint accepts. */
export function shares(release: Release): Share[] {
  if (release.canary === undefined || release.canaryWeight === undefined) {
    return [{ version: release.stable, weight: 100 }];
  }
  return [
    { version: release.stable, weight: 100 - release.canaryWeight },
    { version: release.canary, weight: release.canaryWeight },
  ];
}
// #endregion weights
