import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const EC2_STACK = "AihEc2";

// #region options
/** Where the instance lives, and so how SSM Agent reaches Systems Manager. */
export const PLACEMENTS = ["private", "public"] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Arm64 burstable types with a price in data/pricing/unit-prices.json. */
export const INSTANCE_TYPES = ["t4g.micro", "t4g.small"] as const;
export type InstanceType = (typeof INSTANCE_TYPES)[number];

/** What happens to the data volume when the stack is destroyed. */
export const DATA_ON_DESTROY = ["delete", "snapshot", "retain"] as const;
export type DataOnDestroy = (typeof DATA_ON_DESTROY)[number];
// #endregion options

// #region schema
// A number in cdk.json, a string after `-c dataVolumeGiB=20`. Number("abc") is NaN, which v.number() refuses.
const numeric = v.pipe(v.union([v.number(), v.string()]), v.transform(Number), v.number());

export const ec2ConfigSchema = v.object({
  placement: v.optional(v.picklist(PLACEMENTS), "private"),
  instanceType: v.optional(v.picklist(INSTANCE_TYPES), "t4g.micro"),
  dataVolumeGiB: v.optional(v.pipe(numeric, v.integer(), v.minValue(1), v.maxValue(100)), 8),
  dataOnDestroy: v.optional(v.picklist(DATA_ON_DESTROY), "delete"),
  // Set: the data volume starts as a copy of this snapshot instead of empty.
  dataSnapshotId: v.optional(v.pipe(v.string(), v.regex(/^snap-[0-9a-f]{8,17}$/))),
  // Unset: the latest Amazon Linux 2023, looked up at deploy time. Set: this image, until you change it.
  amiId: v.optional(v.pipe(v.string(), v.regex(/^ami-[0-9a-f]{8,17}$/))),
  // Ends up in a file that systemd reads, so the characters are limited to what an origin needs.
  allowedOrigin: v.optional(
    v.pipe(
      v.string(),
      v.url(),
      v.regex(
        /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/,
        "an origin: scheme, host, and optional port, nothing else",
      ),
    ),
    "http://localhost:5173",
  ),
});

export type Ec2Config = v.InferOutput<typeof ec2ConfigSchema>;
// #endregion schema

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseEc2Config(input: unknown): Ec2Config {
  const result = v.safeParse(ec2ConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid EC2 settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
