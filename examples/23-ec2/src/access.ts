import type { NetworkPlan } from "@aih/example-11-network/src/plan.ts";
import { type Path, pathFrom } from "@aih/example-11-network/src/reach.ts";

import type { Placement } from "./config.ts";

// #region access
/**
 * What the instance must reach, all on port 443, all connections it opens itself.
 * ssm, ssmmessages, ec2messages: the three endpoints the Systems Manager guide lists.
 * s3: Amazon Linux package repositories, SSM Agent updates, and this chapter's releases.
 */
export const SSM_SERVICES = ["ssm", "ssmmessages", "ec2messages"] as const;
export const REQUIRED_SERVICES = [...SSM_SERVICES, "s3"] as const;

/** The first zone only: one instance lives in one subnet. */
export const subnetFor = (placement: Placement): string =>
  placement === "public" ? "Public1" : "Private1";

export type AccessCheck = { service: string; path: Path };

/** Reads the chapter 11 route model. It knows nothing about what is actually deployed. */
export function checkAccess(placement: Placement, network: NetworkPlan): AccessCheck[] {
  return REQUIRED_SERVICES.map((service) => ({
    service,
    path: pathFrom(network, subnetFor(placement), { kind: "aws-service", service }),
  }));
}

export const unreachable = (checks: AccessCheck[]): string[] =>
  checks.filter((check) => !check.path.reachable).map((check) => check.service);
// #endregion access
