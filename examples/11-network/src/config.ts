import { z } from "zod";

import { type Cidr, containsCidr, parseCidr } from "./cidr.ts";

export const REGION = "ap-northeast-1";

// #region options
/** How private subnets reach the internet. Everything but "none" is billed by the hour. */
export const EGRESS_MODES = ["none", "nat", "nat-per-az"] as const;
export type EgressMode = (typeof EGRESS_MODES)[number];

/** Interface endpoints this stack knows how to add: com.amazonaws.ap-northeast-1.<name>. */
export const INTERFACE_SERVICES = [
  "ecr.api",
  "ecr.dkr",
  "logs",
  "secretsmanager",
  "ssm",
  "ssmmessages",
  "ec2messages",
] as const;
export type InterfaceService = (typeof INTERFACE_SERVICES)[number];
// #endregion options

const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].map(parseCidr);

// `-c availabilityZones=ap-northeast-1a,ap-northeast-1c` arrives as one string.
const commaSeparated = (value: unknown): unknown =>
  typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item !== "")
    : value;

// #region schema
export const networkConfigSchema = z
  .object({
    cidr: z.string().default("10.20.0.0/16"),
    // Zone names, not zone IDs: the same name can be a different building in another account.
    availabilityZones: z
      .preprocess(
        commaSeparated,
        z
          .array(z.string().regex(/^ap-northeast-1[a-z]$/))
          .min(2)
          .max(4),
      )
      .default(["ap-northeast-1a", "ap-northeast-1c"]),
    subnetPrefix: z.coerce.number().int().min(17).max(28).default(20),
    egress: z.enum(EGRESS_MODES).default("none"),
    interfaceEndpoints: z
      .preprocess(commaSeparated, z.array(z.enum(INTERFACE_SERVICES)))
      .default([]),
  })
  .superRefine((config, context) => {
    const issue = (path: string, message: string): void =>
      void context.addIssue({ code: "custom", path: [path], message });

    let vpc: Cidr;
    try {
      vpc = parseCidr(config.cidr);
    } catch (error) {
      issue("cidr", error instanceof Error ? error.message : String(error));
      return;
    }
    if (vpc.prefix < 16 || vpc.prefix > 24) {
      issue("cidr", `a VPC of /${vpc.prefix} is outside /16 to /24`);
    }
    if (!PRIVATE_RANGES.some((range) => containsCidr(range, vpc))) {
      issue("cidr", `${config.cidr} is not inside 10.0.0.0/8, 172.16.0.0/12, or 192.168.0.0/16`);
    }
    if (new Set(config.availabilityZones).size !== config.availabilityZones.length) {
      issue("availabilityZones", "the same zone is listed twice");
    }
    if (new Set(config.interfaceEndpoints).size !== config.interfaceEndpoints.length) {
      issue("interfaceEndpoints", "the same service is listed twice");
    }
    // Each tier owns half of the VPC, and needs one block per zone inside it.
    const blocksPerTier = 2 ** (config.subnetPrefix - (vpc.prefix + 1));
    if (blocksPerTier < config.availabilityZones.length) {
      issue(
        "subnetPrefix",
        `half of ${config.cidr} holds ${blocksPerTier < 1 ? 0 : blocksPerTier} subnets of /${config.subnetPrefix}, but ${config.availabilityZones.length} zones need one each`,
      );
    }
  });

export type NetworkConfig = z.infer<typeof networkConfigSchema>;
// #endregion schema

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseNetworkConfig(input: unknown): NetworkConfig {
  const result = networkConfigSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map(
      (item) => `  ${item.path.join(".") || "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid network settings:\n${problems.join("\n")}`);
  }
  return result.data;
}
