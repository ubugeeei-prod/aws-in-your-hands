import { z } from "zod";

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
export const ec2ConfigSchema = z.object({
  placement: z.enum(PLACEMENTS).default("private"),
  instanceType: z.enum(INSTANCE_TYPES).default("t4g.micro"),
  dataVolumeGiB: z.coerce.number().int().min(1).max(100).default(8),
  dataOnDestroy: z.enum(DATA_ON_DESTROY).default("delete"),
  // Set: the data volume starts as a copy of this snapshot instead of empty.
  dataSnapshotId: z
    .string()
    .regex(/^snap-[0-9a-f]{8,17}$/)
    .optional(),
  // Unset: the latest Amazon Linux 2023, looked up at deploy time. Set: this image, until you change it.
  amiId: z
    .string()
    .regex(/^ami-[0-9a-f]{8,17}$/)
    .optional(),
  // Ends up in a file that systemd reads, so the characters are limited to what an origin needs.
  allowedOrigin: z
    .url({ protocol: /^https?$/ })
    .regex(/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/, "an origin: scheme, host, and optional port, nothing else")
    .default("http://localhost:5173"),
});

export type Ec2Config = z.infer<typeof ec2ConfigSchema>;
// #endregion schema

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseEc2Config(input: unknown): Ec2Config {
  const result = ec2ConfigSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map((item) => `  ${item.path.join(".") || "(root)"}: ${item.message}`);
    throw new Error(`Invalid EC2 settings:\n${problems.join("\n")}`);
  }
  return result.data;
}
