import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const DR_STACK = "AihDr";

// #region options
/** Where the staging area lives. It follows the placement of the chapter 23 instance. */
export const PLACEMENTS = ["private", "public"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/**
 * How the two DRS templates come to exist. "api": a person runs the commands `vp run dr:plan`
 * prints. "declare": the stack carries AWS::DRS resources, for a Region whose registry has them.
 */
export const TEMPLATE_MODES = ["api", "declare"] as const;
export type TemplateMode = (typeof TEMPLATE_MODES)[number];
// #endregion options

// #region schema
// A number in cdk.json, a string after `-c pitRetentionDays=14`. Number("abc") is NaN, which v.number() refuses.
const numeric = v.pipe(v.union([v.number(), v.string()]), v.transform(Number), v.number());

export const drConfigSchema = v.object({
  placement: v.optional(v.picklist(PLACEMENTS), "private"),
  templates: v.optional(v.picklist(TEMPLATE_MODES), "api"),
  // The DAY rule of the point-in-time policy. The MINUTE and HOUR rules are fixed by the service.
  pitRetentionDays: v.optional(v.pipe(numeric, v.integer(), v.minValue(1), v.maxValue(365)), 7),
  // The chapter 23 instance's role. Set: the agent's permissions are attached to it.
  sourceRoleName: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9+=,.@_-]{1,64}$/))),
  // The chapter 23 instance's security group. Set: it gains one outbound rule, tcp 1500 inside the VPC.
  sourceSecurityGroupId: v.optional(v.pipe(v.string(), v.regex(/^sg-[0-9a-f]{8,17}$/))),
});

export type DrConfig = v.InferOutput<typeof drConfigSchema>;
// #endregion schema

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseDrConfig(input: unknown): DrConfig {
  const result = v.safeParse(drConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid disaster recovery settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
