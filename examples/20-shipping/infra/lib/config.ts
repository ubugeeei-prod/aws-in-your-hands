import { z } from "zod";

// CDK context arrives as untyped strings from cdk.json or `-c key=value`.

// #region stage
/** `dev`, `prod`, or one preview per pull request: `pr-123`. */
export const stageSchema = z.union([z.literal("dev"), z.literal("prod"), z.string().regex(/^pr-[1-9]\d{0,5}$/)]);
export type Stage = z.infer<typeof stageSchema>;

export const API_STACK_PREFIX = "AihShipApi";

/** One stack per stage, so no two stages ever share a resource. */
export function apiStackName(stage: Stage): string {
  if (stage === "dev") {
    return API_STACK_PREFIX;
  }
  return stage === "prod" ? `${API_STACK_PREFIX}Prod` : `${API_STACK_PREFIX}Pr${stage.slice("pr-".length)}`;
}
// #endregion stage

// #region ci-config
// `owner/repo`, or `owner@123/repo@456` for repositories that use immutable subject claims.
const repository = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*(@\d+)?\/[A-Za-z0-9._-]+(@\d+)?$/, "expected owner/repo or owner@id/repo@id");

// No wildcard may reach a trust policy: `*` or `?` here would widen who can assume the role.
const exactName = z.string().regex(/^[A-Za-z0-9._/-]+$/, "letters, digits, '.', '_', '/', '-' only");

export const ciConfigSchema = z.object({
  githubRepository: repository,
  deployBranch: exactName.default("main"),
  productionEnvironment: exactName.default("production"),
  /** Set when the account already has GitHub's OIDC provider: an account can hold only one. */
  existingOidcProviderArn: z
    .string()
    .regex(/^arn:aws:iam::\d{12}:oidc-provider\/token\.actions\.githubusercontent\.com$/)
    .optional(),
  /** The qualifier `cdk bootstrap` was run with. */
  bootstrapQualifier: z
    .string()
    .regex(/^[a-z0-9]{1,10}$/)
    .default("hnb659fds"),
});
export type CiConfig = z.infer<typeof ciConfigSchema>;
// #endregion ci-config

export const shipConfigSchema = z.object({
  stage: stageSchema.default("dev"),
  allowedOrigin: z.url({ protocol: /^https?$/ }).default("http://localhost:5173"),
  ci: ciConfigSchema,
});
export type ShipConfig = z.infer<typeof shipConfigSchema>;

export function parseShipConfig(context: (key: string) => unknown): ShipConfig {
  const result = shipConfigSchema.safeParse({
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
    const problems = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid CDK context:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}
