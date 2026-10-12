import * as v from "valibot";

import { TASK } from "@aih/example-12-containers/src/config.ts";

export const REGION = "ap-northeast-1";
export const EKS_STACK = "AihEks";

// #region names
/** A fixed name, so that `aws eks update-kubeconfig --name aih-eks` can be written in the book. */
export const CLUSTER_NAME = "aih-eks";

/**
 * The newest version in standard support when this was written (2026-10-13).
 * A string, never a number: 1.40 would otherwise become 1.4.
 */
export const KUBERNETES_VERSION = "1.37";

/** Where the app lives in the cluster. The Pod Identity association names the same two. */
export const NAMESPACE = "notes";
export const SERVICE_ACCOUNT = "notes-api";
export const APP_NAME = "notes-api";
// #endregion names

// #region size
/** One pod: the same quarter of a vCPU and 512 MiB that chapter 12 gave one Fargate task. */
export const POD = {
  cpuMillis: (TASK.cpuUnits / 1024) * 1000,
  memoryMiB: TASK.memoryMiB,
  containerPort: TASK.containerPort,
} as const;

/** How many pods the Deployment keeps, and how a rollout and a drain may change that number. */
export const WORKLOAD = {
  replicas: 2,
  /** A rollout may add this many pods before it removes one. */
  maxSurge: "100%",
  /** A rollout never takes a ready pod away before its replacement is ready. */
  maxUnavailable: 0,
  /** A drain may evict one pod at a time. */
  budgetMaxUnavailable: 1,
} as const;

/**
 * What the nodes may be. One small arm64 type, so the bill is a number that can be
 * written down; the CPU limit caps how many of them Auto Mode may start.
 */
export const NODES = {
  instanceType: "t4g.medium",
  vcpusPerNode: 2,
  cpuLimit: 8,
  ephemeralStorageGiB: 20,
} as const;
// #endregion size

// #region schema
export const NODE_SUBNETS = ["public", "private"] as const;
export type NodeSubnets = (typeof NODE_SUBNETS)[number];

const roleArn = v.pipe(
  v.string(),
  v.regex(
    /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,512}$/,
    "use the ARN of an IAM role, such as arn:aws:iam::123456789012:role/name",
  ),
);

export const eksConfigSchema = v.object({
  // Absent: only whoever creates the cluster can use kubectl. Present: this role may
  // change what is in the app's namespace, and nothing else.
  deployRoleArn: v.optional(roleArn),
});

export type EksConfig = v.InferOutput<typeof eksConfigSchema>;

/** Parses CDK context (`-c deployRoleArn=...`); the message names every bad field. */
export function parseEksConfig(input: unknown): EksConfig {
  const result = v.safeParse(eksConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid cluster settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
// #endregion schema
