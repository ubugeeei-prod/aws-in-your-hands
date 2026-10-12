import type { DrConfig, Placement } from "./config.ts";

// #region pit
export type PitRule = {
  ruleID: number;
  units: "MINUTE" | "HOUR" | "DAY";
  interval: number;
  retentionDuration: number;
  enabled: boolean;
};

/**
 * Exactly three rules. The first two are fixed by the service: a snapshot every 10 minutes
 * kept for 60 minutes, and one an hour kept for 24 hours. Only the days are ours to choose.
 */
export const pitPolicy = (retentionDays: number): PitRule[] => [
  { ruleID: 1, units: "MINUTE", interval: 10, retentionDuration: 60, enabled: true },
  { ruleID: 2, units: "HOUR", interval: 1, retentionDuration: 24, enabled: true },
  { ruleID: 3, units: "DAY", interval: 1, retentionDuration: retentionDays, enabled: true },
];

/** The oldest moment a recovery can go back to. Past it, this service has nothing. */
export const oldestRecoveryPoint = (now: Date, retentionDays: number): Date =>
  new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
// #endregion pit

// #region replication
/** The request of CreateReplicationConfigurationTemplate, in the API's own spelling. */
export type ReplicationTemplate = {
  stagingAreaSubnetId: string;
  associateDefaultSecurityGroup: boolean;
  replicationServersSecurityGroupsIDs: string[];
  replicationServerInstanceType: string;
  useDedicatedReplicationServer: boolean;
  defaultLargeStagingDiskType: "AUTO" | "GP2" | "GP3" | "ST1";
  ebsEncryption: "DEFAULT" | "CUSTOM" | "NONE";
  bandwidthThrottling: number;
  dataPlaneRouting: "PRIVATE_IP" | "PUBLIC_IP";
  createPublicIP: boolean;
  stagingAreaTags: Record<string, string>;
  pitPolicy: PitRule[];
  autoReplicateNewDisks: boolean;
};

export const STAGING_TAGS = { "aih:chapter": "40", "aih:stack": "AihDr" } as const;

export function replicationTemplate(
  config: Pick<DrConfig, "placement" | "pitRetentionDays">,
  stagingAreaSubnetId: string,
): ReplicationTemplate {
  return {
    stagingAreaSubnetId,
    // The service's own group: inbound tcp 1500, kept in shape by the service.
    associateDefaultSecurityGroup: true,
    replicationServersSecurityGroupsIDs: [],
    // The documented default, written down so that a change is a diff.
    replicationServerInstanceType: "t3.small",
    useDedicatedReplicationServer: false,
    defaultLargeStagingDiskType: "AUTO",
    ebsEncryption: "DEFAULT",
    bandwidthThrottling: 0,
    // Source and staging area share a VPC: blocks never leave it.
    dataPlaneRouting: "PRIVATE_IP",
    // In a subnet with no route out, a public address would reach nothing and still be billed.
    createPublicIP: needsPublicAddress(config.placement),
    stagingAreaTags: { ...STAGING_TAGS },
    pitPolicy: pitPolicy(config.pitRetentionDays),
    autoReplicateNewDisks: true,
  };
}

export const needsPublicAddress = (placement: Placement): boolean => placement === "public";
// #endregion replication

// #region launch
/** The request of CreateLaunchConfigurationTemplate: defaults for source servers added later. */
export type LaunchTemplate = {
  launchDisposition: "STARTED" | "STOPPED";
  targetInstanceTypeRightSizingMethod: "NONE" | "BASIC" | "IN_AWS";
  copyPrivateIp: boolean;
  copyTags: boolean;
  postLaunchEnabled: boolean;
  launchIntoSourceInstance: boolean;
};

export const launchTemplate = (): LaunchTemplate => ({
  launchDisposition: "STARTED",
  // The EC2 launch template of the source server names the instance type. Nothing overwrites it.
  targetInstanceTypeRightSizingMethod: "NONE",
  // The drill instance lives in another subnet, where the source's address does not exist.
  copyPrivateIp: false,
  copyTags: true,
  postLaunchEnabled: false,
  launchIntoSourceInstance: false,
});
// #endregion launch

// #region commands
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The steps that exist only as API calls, as AWS CLI commands. Printed, never run from here.
 * The bodies are the API requests themselves, so the CLI has no list syntax to get wrong.
 */
export function setupCommands(
  config: Pick<DrConfig, "placement" | "pitRetentionDays">,
  region: string,
  stagingAreaSubnetId = "<StagingSubnetId output>",
): string[] {
  const body = (value: unknown): string => shellQuote(JSON.stringify(value));
  return [
    `aws drs initialize-service --region ${region}`,
    `aws drs create-replication-configuration-template --region ${region} --cli-input-json ${body(replicationTemplate(config, stagingAreaSubnetId))}`,
    `aws drs create-launch-configuration-template --region ${region} --cli-input-json ${body(launchTemplate())}`,
  ];
}
// #endregion commands
