import type { NetworkPlan } from "@aih/example-11-network/src/plan.ts";
import { type Path, pathFrom } from "@aih/example-11-network/src/reach.ts";

import type { Placement } from "./config.ts";

// #region layout
/**
 * The source stays in the first zone, where chapter 23 put it. The staging area and the
 * recovery instance go to the second zone, so losing the first zone leaves both standing.
 */
export const sourceSubnet = (placement: Placement): string =>
  placement === "public" ? "Public1" : "Private1";
export const stagingSubnet = (placement: Placement): string =>
  placement === "public" ? "Public2" : "Private2";

/** Interface endpoints this chapter's stack adds when nothing in the VPC can reach the internet. */
export const OWN_ENDPOINTS = ["drs", "ec2"] as const;
export const ownEndpoints = (placement: Placement): readonly string[] =>
  placement === "private" ? OWN_ENDPOINTS : [];
// #endregion layout

// #region needs
/**
 * From the network requirements page: every arrow is opened by the side named first.
 * The agent talks to the service and downloads from S3 on 443, and streams blocks to the
 * replication server on 1500. The replication server needs the service, the EC2 API, and S3.
 */
export const NEEDS = [
  { from: "source", service: "drs", port: 443, why: "agent control channel" },
  { from: "source", service: "s3", port: 443, why: "agent installer" },
  { from: "staging", service: "drs", port: 443, why: "replication server control channel" },
  { from: "staging", service: "ec2", port: 443, why: "replication server calls the EC2 API" },
  { from: "staging", service: "s3", port: 443, why: "replication software, AL2023 packages" },
] as const;

export type NetworkCheck = (typeof NEEDS)[number] & { subnet: string; path: Path };

/**
 * Reads the chapter 11 route model plus this stack's own endpoints. It knows nothing about
 * security groups, endpoint policies, DNS, or what is actually deployed.
 */
export function checkPaths(placement: Placement, network: NetworkPlan): NetworkCheck[] {
  const own = ownEndpoints(placement);
  return NEEDS.map((need) => {
    const subnet = need.from === "source" ? sourceSubnet(placement) : stagingSubnet(placement);
    // An interface endpoint in one subnet answers for the whole VPC through its private DNS name.
    const path: Path = own.includes(need.service)
      ? { reachable: true, via: "interface-endpoint" }
      : pathFrom(network, subnet, { kind: "aws-service", service: need.service });
    return { ...need, subnet, path };
  });
}

export const unreachable = (checks: NetworkCheck[]): NetworkCheck[] =>
  checks.filter((check) => !check.path.reachable);
// #endregion needs
