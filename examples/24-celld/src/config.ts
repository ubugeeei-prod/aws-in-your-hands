import { z } from "zod";

export const REGION = "ap-northeast-1";
export const CELLD_STACK = "AihCelld";

// #region options
/** Up to three nodes: an owner and the two followers celld recruits at most. */
export const NODE_NAMES = ["a", "b", "c"] as const;
export type NodeName = (typeof NODE_NAMES)[number];

/** Arm64 burstable types with a price in data/pricing/unit-prices.json. */
export const INSTANCE_TYPES = ["t4g.small", "t4g.micro"] as const;
export type InstanceType = (typeof INSTANCE_TYPES)[number];

/** What happens to the fleet bucket and the node volumes when the stack is destroyed. */
export const STATE_ON_DESTROY = ["retain", "delete"] as const;
export type StateOnDestroy = (typeof STATE_ON_DESTROY)[number];
// #endregion options

const snapshotId = z.string().regex(/^snap-[0-9a-f]{8,17}$/);

// `-c dataSnapshots=a:snap-0123...,b:snap-4567...` arrives as one string.
const snapshotMap = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  return Object.fromEntries(
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "")
      .map((item) => {
        const separator = item.indexOf(":");
        return separator < 1 ? [item, ""] : [item.slice(0, separator), item.slice(separator + 1)];
      }),
  );
};

// #region schema
export const fleetConfigSchema = z
  .object({
    // Zero by default: the bucket, the role, and the security group cost nothing by the hour.
    nodes: z.coerce.number().int().min(0).max(NODE_NAMES.length).default(0),
    instanceType: z.enum(INSTANCE_TYPES).default("t4g.small"),
    dataVolumeGiB: z.coerce.number().int().min(1).max(100).default(8),
    // The bucket is the fleet's long-term state, and a node disk can hold writes the bucket lacks.
    stateOnDestroy: z.enum(STATE_ON_DESTROY).default("retain"),
    // Restore only: a node listed here gets a data volume created from that snapshot.
    dataSnapshots: z.preprocess(snapshotMap, z.partialRecord(z.enum(NODE_NAMES), snapshotId)).default({}),
    // Unset: the latest Amazon Linux 2023, looked up at deploy time. Set: this image, until you change it.
    amiId: z
      .string()
      .regex(/^ami-[0-9a-f]{8,17}$/)
      .optional(),
  })
  .superRefine((config, context) => {
    for (const node of Object.keys(config.dataSnapshots)) {
      if (!nodeNames(config.nodes).includes(node as NodeName)) {
        context.addIssue({
          code: "custom",
          path: ["dataSnapshots", node],
          message: `node ${node} is not part of a fleet of ${config.nodes}`,
        });
      }
    }
  });

export type FleetConfig = z.infer<typeof fleetConfigSchema>;
// #endregion schema

/** The first `count` names, in the order every script walks the fleet. */
export function nodeNames(count: number): NodeName[] {
  return NODE_NAMES.slice(0, count);
}

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseFleetConfig(input: unknown): FleetConfig {
  const result = fleetConfigSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues.map((item) => `  ${item.path.join(".") || "(root)"}: ${item.message}`);
    throw new Error(`Invalid fleet settings:\n${problems.join("\n")}`);
  }
  return result.data;
}
