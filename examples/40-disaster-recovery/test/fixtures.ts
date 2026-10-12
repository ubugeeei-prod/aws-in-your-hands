// Written by hand for these tests, from the member names and value patterns of the
// Elastic Disaster Recovery API reference and the event samples in its user guide.
// Nothing here was recorded from an account: no such call was ever made for this book.

export const SERVER_A = "s-1111111111aaaaaaa";
export const SERVER_B = "s-2222222222bbbbbbb";

/** DescribeSourceServers `items`, with members the schemas are expected to drop. */
export const sourceServers = [
  {
    sourceServerID: SERVER_A,
    arn: `arn:aws:drs:ap-northeast-1:111122223333:source-server/${SERVER_A}`,
    lastLaunchResult: "SUCCEEDED",
    dataReplicationInfo: {
      dataReplicationState: "CONTINUOUS",
      lagDuration: "PT4S",
      replicatedDisks: [{ deviceName: "/dev/nvme0n1", totalStorageBytes: 8589934592 }],
      stagingAvailabilityZone: "ap-northeast-1c",
    },
    sourceCloudProperties: {
      originAccountID: "111122223333",
      originRegion: "ap-northeast-1",
      originAvailabilityZone: "ap-northeast-1a",
    },
    replicationDirection: "FAILOVER",
    tags: {},
  },
  {
    sourceServerID: SERVER_B,
    dataReplicationInfo: { dataReplicationState: "STALLED" },
    sourceCloudProperties: {},
  },
];

/** DescribeRecoverySnapshots `items` for SERVER_A, newest first. The last one was never taken. */
export const recoverySnapshots = [
  {
    snapshotID: "pit-0000000000000003c",
    sourceServerID: SERVER_A,
    expectedTimestamp: "2026-10-13T09:00:00.000000Z",
    timestamp: "2026-10-13T09:00:04.512000Z",
    ebsSnapshots: ["snap-0aaaaaaaaaaaaaaa1", "snap-0aaaaaaaaaaaaaaa2"],
  },
  {
    snapshotID: "pit-0000000000000002b",
    sourceServerID: SERVER_A,
    expectedTimestamp: "2026-10-13T08:50:00.000000Z",
    timestamp: "2026-10-13T08:50:03.100000Z",
  },
  {
    snapshotID: "pit-0000000000000001a",
    sourceServerID: SERVER_A,
    expectedTimestamp: "2026-10-13T08:40:00.000000Z",
  },
];

/** DescribeRecoveryInstances `items`: a drill still running, a real recovery, a drill long gone. */
export const recoveryInstances = [
  {
    recoveryInstanceID: "i-0d00000000000000d",
    ec2InstanceID: "i-0d00000000000000d",
    ec2InstanceState: "RUNNING",
    sourceServerID: SERVER_A,
    jobID: "drsjob-00000000000000001",
    isDrill: true,
    pointInTimeSnapshotDateTime: "2026-10-13T09:00:04.512000Z",
  },
  {
    recoveryInstanceID: "i-0e00000000000000e",
    ec2InstanceState: "RUNNING",
    sourceServerID: SERVER_B,
    isDrill: false,
  },
  {
    recoveryInstanceID: "i-0f00000000000000f",
    ec2InstanceState: "TERMINATED",
    sourceServerID: SERVER_A,
    isDrill: true,
  },
];

/** A Job as StartRecovery returns it. */
export const launchJob = {
  jobID: "drsjob-00000000000000001",
  arn: "arn:aws:drs:ap-northeast-1:111122223333:job/drsjob-00000000000000001",
  type: "LAUNCH",
  initiatedBy: "START_DRILL",
  creationDateTime: "2026-10-13T09:02:00.000000Z",
  status: "PENDING",
  participatingServers: [{ sourceServerID: SERVER_A, launchStatus: "PENDING" }],
};

const envelope = {
  version: "0",
  id: "9da9af57-9253-4406-87cb-7cc400e43465",
  source: "aws.drs",
  account: "111122223333",
  time: "2026-10-13T09:20:00Z",
  region: "ap-northeast-1",
};
const serverArn = `arn:aws:drs:ap-northeast-1:111122223333:source-server/${SERVER_A}`;

/** The user guide's samples, with this book's Region and server ID. */
export const events = {
  drillSucceeded: {
    ...envelope,
    "detail-type": "DRS Source Server Launch Result",
    resources: [serverArn],
    detail: {
      state: "RECOVERY_LAUNCH_SUCCEEDED",
      "job-id": "drsjob-00000000000000001",
      "is-drill": "TRUE",
    },
  },
  recoveryFailed: {
    ...envelope,
    "detail-type": "DRS Source Server Launch Result",
    resources: [serverArn],
    detail: {
      state: "RECOVERY_LAUNCH_FAILED",
      "job-id": "drsjob-00000000000000002",
      "is-drill": "FALSE",
    },
  },
  stalled: {
    ...envelope,
    "detail-type": "DRS Source Server Data Replication Stalled Change",
    resources: [serverArn],
    detail: { state: "STALLED" },
  },
  failbackCompleted: {
    ...envelope,
    "detail-type": "DRS Recovery Instance Failback State Change",
    resources: ["arn:aws:drs:ap-northeast-1:111122223333:recovery-instance/ri-12345678901234567"],
    detail: { state: "FAILBACK_COMPLETED" },
  },
  // Not routed to the handler by the rule, and not known to its schema.
  snapshotTaken: {
    ...envelope,
    "detail-type": "DRS PIT Snapshot Taken",
    resources: [serverArn],
    detail: { DrsSnapshotID: "112233", EbsSnapshotIDs: "445566,778899" },
  },
};
