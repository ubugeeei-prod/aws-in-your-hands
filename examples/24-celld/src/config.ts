import * as v from "valibot";

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

const snapshotId = v.pipe(v.string(), v.regex(/^snap-[0-9a-f]{8,17}$/));

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
// A number in cdk.json, a string after `-c nodes=3`. Number("abc") is NaN, which v.number() refuses.
const numeric = v.pipe(v.union([v.number(), v.string()]), v.transform(Number), v.number());

export const fleetConfigSchema = v.pipe(
  v.object({
    // Zero by default: the bucket, the role, and the security group cost nothing by the hour.
    nodes: v.optional(
      v.pipe(numeric, v.integer(), v.minValue(0), v.maxValue(NODE_NAMES.length)),
      0,
    ),
    instanceType: v.optional(v.picklist(INSTANCE_TYPES), "t4g.small"),
    dataVolumeGiB: v.optional(v.pipe(numeric, v.integer(), v.minValue(1), v.maxValue(100)), 8),
    // The bucket is the fleet's long-term state, and a node disk can hold writes the bucket lacks.
    stateOnDestroy: v.optional(v.picklist(STATE_ON_DESTROY), "retain"),
    // Restore only: a node listed here gets a data volume created from that snapshot.
    dataSnapshots: v.optional(
      v.pipe(v.unknown(), v.transform(snapshotMap), v.record(v.picklist(NODE_NAMES), snapshotId)),
      {},
    ),
    // Unset: the latest Amazon Linux 2023, looked up at deploy time. Set: this image, until you change it.
    amiId: v.optional(v.pipe(v.string(), v.regex(/^ami-[0-9a-f]{8,17}$/))),
  }),
  // A snapshot for a node the fleet does not have. Waits until every field has the right type.
  v.rawCheck(({ dataset, addIssue }) => {
    if (!dataset.typed) {
      return;
    }
    const config = dataset.value;
    const snapshots: Record<string, unknown> = config.dataSnapshots;
    for (const node of Object.keys(snapshots)) {
      if (!nodeNames(config.nodes).includes(node as NodeName)) {
        addIssue({
          message: `node ${node} is not part of a fleet of ${config.nodes}`,
          path: [
            {
              type: "object",
              origin: "value",
              input: config,
              key: "dataSnapshots",
              value: snapshots,
            },
            {
              type: "object",
              origin: "value",
              input: snapshots,
              key: node,
              value: snapshots[node],
            },
          ],
        });
      }
    }
  }),
);

export type FleetConfig = v.InferOutput<typeof fleetConfigSchema>;
// #endregion schema

/** The first `count` names, in the order every script walks the fleet. */
export function nodeNames(count: number): NodeName[] {
  return NODE_NAMES.slice(0, count);
}

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseFleetConfig(input: unknown): FleetConfig {
  const result = v.safeParse(fleetConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid fleet settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
