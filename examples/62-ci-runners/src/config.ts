import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const RUNNER_STACK = "AihCiRunners";

// #region runner
/** One job's environment: what a task is made of, and how long it may live. */
export const RUNNER = {
  /** The same size as GitHub's standard Linux runner for a private repository: 2 vCPU, 8 GB. */
  cpuUnits: 2048,
  memoryMiB: 8192,
  /**
   * GitHub's own runner image, by tag and by digest. The digest is what is pulled;
   * the tag only says which release it was on 2026-10-13.
   */
  image:
    "ghcr.io/actions/actions-runner:2.338.0@sha256:4ffadc0002b2581327e06101fc8c06cd189232baf79fe561fac9caeb76f5e807",
  entryPoint: "/home/runner/run.sh",
  containerName: "runner",
  /** The only label the runners carry. A workflow asks for it with `runs-on: aih-fargate`. */
  label: "aih-fargate",
  /** Seconds. A task older than this is stopped, whatever it is doing. */
  maxTaskSeconds: 6 * 60 * 60,
  sweepMinutes: 15,
} as const;
// #endregion runner

// #region timing
/** Seconds. The receiver has to answer GitHub within ten, and a claim outlives the receiver. */
export const TIMING = {
  githubAnswerLimit: 10,
  receiverTimeout: 9,
  /** A receiver that died holds its claim this long. Longer than the receiver can run. */
  claimLease: 60,
  /** How long a finished claim is kept, so a late redelivery is still recognised. */
  claimRetention: 2 * 24 * 60 * 60,
} as const;
// #endregion timing

/** RunTask allows 8192 characters for the whole `overrides` structure. */
export const OVERRIDES_LIMIT = 8192;
export const MAX_BODY_BYTES = 1024 * 1024;

// #region context
const repository = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/, "expected owner/repo"),
);

export const runnerConfigSchema = v.object({
  /** The repositories whose jobs get a runner. Empty: every delivery is refused. */
  repositories: v.optional(
    v.pipe(
      v.string(),
      v.transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item !== ""),
      ),
      v.array(repository),
    ),
    "",
  ),
  /** The GitHub App's client ID, which signs in as the app. Not a secret. */
  appClientId: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9._-]{1,64}$/))),
  /** The runner group new runners join. GitHub's API example uses 1. */
  runnerGroupId: v.optional(
    v.pipe(v.string(), v.regex(/^[1-9]\d{0,8}$/), v.transform(Number)),
    "1",
  ),
});
export type RunnerConfig = v.InferOutput<typeof runnerConfigSchema>;

export function parseRunnerConfig(input: unknown): RunnerConfig {
  const result = v.safeParse(runnerConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion context
