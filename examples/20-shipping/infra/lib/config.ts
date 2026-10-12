import * as v from "valibot";

// CDK context arrives as untyped strings from cdk.json or `-c key=value`.

// #region stage
/** `dev`, `prod`, or one preview per pull request: `pr-123`. */
export const stageSchema = v.union([
  v.literal("dev"),
  v.literal("prod"),
  v.pipe(v.string(), v.regex(/^pr-[1-9]\d{0,5}$/)),
]);
export type Stage = v.InferOutput<typeof stageSchema>;

export const API_STACK_PREFIX = "AihShipApi";

/** One stack per stage, so no two stages ever share a resource. */
export function apiStackName(stage: Stage): string {
  if (stage === "dev") {
    return API_STACK_PREFIX;
  }
  return stage === "prod"
    ? `${API_STACK_PREFIX}Prod`
    : `${API_STACK_PREFIX}Pr${stage.slice("pr-".length)}`;
}
// #endregion stage

// #region ci-config
// `owner/repo`, or `owner@123/repo@456` for repositories that use immutable subject claims.
const repository = v.pipe(
  v.string(),
  v.regex(
    /^[A-Za-z0-9][A-Za-z0-9-]*(@\d+)?\/[A-Za-z0-9._-]+(@\d+)?$/,
    "expected owner/repo or owner@id/repo@id",
  ),
);

// No wildcard may reach a trust policy: `*` or `?` here would widen who can assume the role.
const exactName = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9._/-]+$/, "letters, digits, '.', '_', '/', '-' only"),
);

export const ciConfigSchema = v.object({
  githubRepository: repository,
  deployBranch: v.optional(exactName, "main"),
  productionEnvironment: v.optional(exactName, "production"),
  /** Set when the account already has GitHub's OIDC provider: an account can hold only one. */
  existingOidcProviderArn: v.optional(
    v.pipe(
      v.string(),
      v.regex(/^arn:aws:iam::\d{12}:oidc-provider\/token\.actions\.githubusercontent\.com$/),
    ),
  ),
  /** The qualifier `cdk bootstrap` was run with. */
  bootstrapQualifier: v.optional(v.pipe(v.string(), v.regex(/^[a-z0-9]{1,10}$/)), "hnb659fds"),
});
export type CiConfig = v.InferOutput<typeof ciConfigSchema>;
// #endregion ci-config

export const shipConfigSchema = v.object({
  stage: v.optional(stageSchema, "dev"),
  allowedOrigin: v.optional(
    v.pipe(
      v.string(),
      v.url(),
      v.check((value) => /^https?:$/.test(new URL(value).protocol), "expected http or https"),
    ),
    "http://localhost:5173",
  ),
  ci: ciConfigSchema,
});
export type ShipConfig = v.InferOutput<typeof shipConfigSchema>;

export function parseShipConfig(context: (key: string) => unknown): ShipConfig {
  const result = v.safeParse(shipConfigSchema, {
    stage: context("stage"),
    allowedOrigin: context("allowedOrigin"),
    ci: {
      githubRepository: context("githubRepository"),
      deployBranch: context("deployBranch"),
      productionEnvironment: context("productionEnvironment"),
      existingOidcProviderArn: context("existingOidcProviderArn"),
      bootstrapQualifier: context("bootstrapQualifier"),
    },
  });
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
