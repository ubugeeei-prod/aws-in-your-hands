import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const DISTSQL_STACK = "AihDistSql";

// #region options
/**
 * Arm64 types with a price in data/pricing/unit-prices.json. t4g.medium has the
 * 2 vCPUs and more than the 2 GiB the documentation calls the minimum;
 * m7g.large is the smallest of the family it recommends on AWS.
 */
export const INSTANCE_TYPES = ["t4g.medium", "m7g.large"] as const;
export type InstanceType = (typeof INSTANCE_TYPES)[number];

/** What happens to the bucket and the node volumes when the stack is destroyed. */
export const STATE_ON_DESTROY = ["retain", "delete"] as const;
// #endregion options

// #region schema
// A number in cdk.json, a string after `-c nodes=3`. Number("abc") is NaN, which v.number() refuses.
const numeric = v.pipe(v.union([v.number(), v.string()]), v.transform(Number), v.number());

export const clusterConfigSchema = v.object({
  // None by default: the bucket, the role, and the security groups cost nothing by the hour.
  // Otherwise three. Two cannot lose one, and four tolerate no more than three do.
  nodes: v.optional(v.pipe(numeric, v.picklist([0, 3])), 0),
  instanceType: v.optional(v.picklist(INSTANCE_TYPES), "t4g.medium"),
  // The archive unpacks onto this volume too, and needs a few GiB of it.
  dataVolumeGiB: v.optional(v.pipe(numeric, v.integer(), v.minValue(20), v.maxValue(500)), 20),
  // The volumes are the database. Losing them with the stack must be asked for.
  stateOnDestroy: v.optional(v.picklist(STATE_ON_DESTROY), "retain"),
  // Unset: the latest Amazon Linux 2023, looked up at deploy time. Set: this image, until you change it.
  amiId: v.optional(v.pipe(v.string(), v.regex(/^ami-[0-9a-f]{8,17}$/))),
});
export type ClusterConfig = v.InferOutput<typeof clusterConfigSchema>;
// #endregion schema

/** Parses settings from CDK context; the message names every bad field. */
export function parseClusterConfig(input: unknown): ClusterConfig {
  const result = v.safeParse(clusterConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid cluster settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
