import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

// The parts of four API responses this chapter decides on. Member names and enum values are
// those of @aws-sdk/client-drs 3.1149.0 and the API reference. Everything else is dropped.

// #region shapes
export const REPLICATION_STATES = [
  "STOPPED",
  "INITIATING",
  "INITIAL_SYNC",
  "BACKLOG",
  "CREATING_SNAPSHOT",
  "CONTINUOUS",
  "PAUSED",
  "RESCAN",
  "STALLED",
  "DISCONNECTED",
] as const;
export type ReplicationState = (typeof REPLICATION_STATES)[number];

const sourceServerId = v.pipe(v.string(), v.regex(/^s-[0-9a-zA-Z]{17}$/));
const instanceId = v.pipe(v.string(), v.regex(/^i-[0-9a-fA-F]{8,}$/));

export const sourceServerSchema = v.object({
  sourceServerID: sourceServerId,
  recoveryInstanceId: v.optional(instanceId),
  lastLaunchResult: v.optional(v.picklist(["NOT_STARTED", "PENDING", "SUCCEEDED", "FAILED"])),
  dataReplicationInfo: v.optional(
    v.object({
      dataReplicationState: v.optional(v.picklist(REPLICATION_STATES)),
      // A string of 1 to 64 characters is all the API reference promises.
      lagDuration: v.optional(v.string()),
    }),
    {},
  ),
  sourceCloudProperties: v.optional(
    v.object({ originAvailabilityZone: v.optional(v.string()) }),
    {},
  ),
});
export type SourceServer = v.InferOutput<typeof sourceServerSchema>;

export const recoverySnapshotSchema = v.object({
  snapshotID: v.pipe(v.string(), v.regex(/^pit-[0-9a-zA-Z]{17}$/)),
  sourceServerID: sourceServerId,
  expectedTimestamp: utcTimestamp,
  // Absent until the snapshot is actually taken.
  timestamp: v.optional(utcTimestamp),
});
export type RecoverySnapshot = v.InferOutput<typeof recoverySnapshotSchema>;

export const jobSchema = v.object({
  jobID: v.pipe(v.string(), v.regex(/^drsjob-[0-9a-zA-Z]{17}$/)),
  type: v.optional(v.picklist(["LAUNCH", "TERMINATE", "CREATE_CONVERTED_SNAPSHOT"])),
  initiatedBy: v.optional(v.string()),
  status: v.optional(v.picklist(["PENDING", "STARTED", "COMPLETED"])),
  creationDateTime: v.optional(utcTimestamp),
  endDateTime: v.optional(utcTimestamp),
  participatingServers: v.optional(
    v.array(
      v.object({
        sourceServerID: v.optional(sourceServerId),
        recoveryInstanceID: v.optional(instanceId),
        launchStatus: v.optional(
          v.picklist(["PENDING", "IN_PROGRESS", "LAUNCHED", "FAILED", "TERMINATED"]),
        ),
      }),
    ),
    [],
  ),
});
export type Job = v.InferOutput<typeof jobSchema>;

export const recoveryInstanceSchema = v.object({
  recoveryInstanceID: instanceId,
  ec2InstanceID: v.optional(instanceId),
  ec2InstanceState: v.optional(
    v.picklist([
      "PENDING",
      "RUNNING",
      "STOPPING",
      "STOPPED",
      "SHUTTING-DOWN",
      "TERMINATED",
      "NOT_FOUND",
    ]),
  ),
  sourceServerID: v.optional(sourceServerId),
  jobID: v.optional(v.string()),
  isDrill: v.optional(v.boolean()),
  pointInTimeSnapshotDateTime: v.optional(utcTimestamp),
});
export type RecoveryInstance = v.InferOutput<typeof recoveryInstanceSchema>;
// #endregion shapes

// #region lag
/**
 * The API reference gives lagDuration no format. Values that look like an ISO 8601 duration
 * ("PT5S", "PT1H2M") become seconds. Anything else is null, which callers must treat as
 * "unknown", never as zero.
 */
export function lagSeconds(lagDuration: string | undefined): number | null {
  if (lagDuration === undefined) {
    return null;
  }
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(lagDuration);
  if (match === null || lagDuration === "P" || lagDuration.endsWith("T")) {
    return null;
  }
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}
// #endregion lag
