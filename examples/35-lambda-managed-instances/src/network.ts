import type { NetworkPlan } from "@aih/example-11-network/src/plan.ts";
import { subnetsOf } from "@aih/example-11-network/src/plan.ts";
import { type Path, pathFrom } from "@aih/example-11-network/src/reach.ts";

// #region network
/**
 * What the instances must reach from their subnets, on port 443. The guide names
 * CloudWatch Logs and X-Ray for telemetry. This stack does not turn tracing on.
 */
export const REQUIRED_SERVICES = ["logs"] as const;

/** What to pass to the chapter 11 stack. Its endpoints are that stack's resources, and its bill. */
export const NETWORK_SETTINGS: Record<string, string> = {
  interfaceEndpoints: REQUIRED_SERVICES.join(","),
};

export type AccessCheck = { subnetId: string; service: string; path: Path };

/** Reads the chapter 11 route model for every private subnet. It knows nothing about what is deployed. */
export function checkAccess(network: NetworkPlan): AccessCheck[] {
  return subnetsOf(network, "private").flatMap((subnet) =>
    REQUIRED_SERVICES.map((service) => ({
      subnetId: subnet.id,
      service,
      path: pathFrom(network, subnet.id, { kind: "aws-service", service }),
    })),
  );
}

export const unreachable = (checks: AccessCheck[]): string[] =>
  checks
    .filter((check) => !check.path.reachable)
    .map((check) => `${check.service} from ${check.subnetId}`);
// #endregion network
