import * as v from "valibot";

import { STATE_PREFIX } from "./commands.ts";

// What cdkd recorded in its state bucket, read without cdkd. The record says what cdkd
// believes it created; it is not a look at the resources themselves.

// #region keys
/** JMESPath `Contents[].Key` prints null for a prefix with nothing under it. */
export const stateKeysSchema = v.nullable(v.array(v.string()));

export type StateRef = { stack: string; region: string | undefined; key: string };

const STATE_KEY = new RegExp(
  `^${STATE_PREFIX}/([A-Za-z][A-Za-z0-9-]*)/(?:([a-z]{2}(?:-[a-z]+)+-\\d)/)?state\\.json$`,
);

/** Locks and journals live under the same prefix; only state.json names a stack. */
export function stateRefs(keys: readonly string[] | null): StateRef[] {
  return (keys ?? [])
    .flatMap((key) => {
      const match = STATE_KEY.exec(key);
      return match === null ? [] : [{ stack: match[1] as string, region: match[2], key }];
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
// #endregion keys

// #region idle
/** Resource types an earlier chapter calls out as billed for existing, and where it says so. */
export const BILLED_WHILE_IDLE: Record<string, string> = {
  "AWS::EC2::NatGateway": "11",
  "AWS::EC2::EIP": "11",
  "AWS::ElasticLoadBalancingV2::LoadBalancer": "12",
  "AWS::ECS::Service": "12",
  "AWS::ElastiCache::ServerlessCache": "14",
  "AWS::KMS::Key": "21",
  "AWS::SecretsManager::Secret": "21",
  "AWS::WAFv2::WebACL": "21",
  "AWS::EC2::Instance": "23",
  "AWS::EC2::Volume": "23",
};

const resource = v.object({
  physicalId: v.string(),
  resourceType: v.string(),
  properties: v.optional(v.record(v.string(), v.unknown()), {}),
});

/** The fields of cdkd's StackState that this reads. The rest is left alone. */
export const stateSchema = v.object({
  stackName: v.string(),
  region: v.optional(v.string()),
  resources: v.record(v.string(), resource),
});
export type StackState = v.InferOutput<typeof stateSchema>;

// A gateway endpoint has no hourly price; an interface endpoint does (chapter 11).
const billedChapter = (item: v.InferOutput<typeof resource>): string | undefined =>
  item.resourceType === "AWS::EC2::VPCEndpoint"
    ? item.properties["VpcEndpointType"] === "Interface"
      ? "11"
      : undefined
    : BILLED_WHILE_IDLE[item.resourceType];

export type StackSummary = {
  stack: string;
  region: string | undefined;
  resources: number;
  /** What `empty` would be pointed at before this stack is destroyed. */
  buckets: string[];
  idle: { logicalId: string; type: string; physicalId: string; chapter: string }[];
};

export function summarize(ref: StateRef, state: StackState): StackSummary {
  const idle = Object.entries(state.resources).flatMap(([logicalId, item]) => {
    const chapter = billedChapter(item);
    return chapter === undefined
      ? []
      : [{ logicalId, type: item.resourceType, physicalId: item.physicalId, chapter }];
  });
  return {
    stack: state.stackName,
    region: state.region ?? ref.region,
    resources: Object.keys(state.resources).length,
    buckets: Object.values(state.resources)
      .filter((item) => item.resourceType === "AWS::S3::Bucket")
      .map((item) => item.physicalId)
      .sort(),
    idle: idle.sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
  };
}
// #endregion idle

// #region render
export function renderLeft(bucket: string, summaries: readonly StackSummary[]): string[] {
  if (summaries.length === 0) {
    return [`${bucket} records no stack.`];
  }
  const lines = summaries.flatMap((summary) => [
    `${summary.stack} (${summary.region ?? "region not recorded"}): ${summary.resources} resources`,
    ...summary.buckets.map((bucket) => `  bucket: ${bucket}`),
    ...summary.idle.map(
      (item) => `  billed while idle (chapter ${item.chapter}): ${item.type} ${item.physicalId}`,
    ),
  ]);
  const idle = summaries.reduce((sum, summary) => sum + summary.idle.length, 0);
  return [
    ...lines,
    `${summaries.length} stacks recorded in ${bucket}; ${idle} resources of a kind that is billed while idle.`,
    "This is cdkd's record, not a look at the resources. A stack deployed another way is not in it.",
  ];
}
// #endregion render
