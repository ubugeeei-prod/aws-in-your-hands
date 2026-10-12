import type { RecoveryInstance, SourceServer } from "./drs.ts";

// #region billed
export type BilledLine = {
  resource: string;
  billed: "yes" | "winding-down" | "no";
  what: string;
  next: string;
};

/**
 * What the two list calls of the DRS API say is still costing money. The service's own fee
 * and the staging area follow the source server; an instance follows its EC2 state.
 */
export function stillBilled(
  sourceServers: SourceServer[],
  recoveryInstances: RecoveryInstance[],
): BilledLine[] {
  const lines: BilledLine[] = [];
  for (const server of sourceServers) {
    const state = server.dataReplicationInfo.dataReplicationState;
    const hasInstance = recoveryInstances.some(
      (instance) => instance.sourceServerID === server.sourceServerID,
    );
    if (state === "DISCONNECTED") {
      lines.push({
        resource: server.sourceServerID,
        // "Terminated / deleted within 90 minutes" of the disconnect, says the API reference.
        billed: "winding-down",
        what: "disconnected: the staging resources are being deleted; the record remains",
        next: "delete-source-server",
      });
    } else if (state === "STOPPED") {
      lines.push({
        resource: server.sourceServerID,
        billed: "no",
        what: "replication stopped: no fee and no staging area, and no snapshots either",
        next: "disconnect-source-server, then delete-source-server",
      });
    } else {
      lines.push({
        resource: server.sourceServerID,
        billed: "yes",
        what: `replicating (${state ?? "state not reported"}): the hourly fee, the replication server, staging disks, snapshots`,
        next: hasInstance
          ? "terminate its recovery instance first: a server with one cannot be disconnected"
          : "disconnect-source-server, then delete-source-server",
      });
    }
  }
  for (const instance of recoveryInstances) {
    const state = instance.ec2InstanceState;
    const gone = state === "TERMINATED" || state === "NOT_FOUND";
    const kind = instance.isDrill === true ? "drill" : "recovery";
    lines.push({
      resource: instance.recoveryInstanceID,
      billed: gone ? "no" : "yes",
      what: gone
        ? `${kind} instance, EC2 state ${state}`
        : `${kind} instance, EC2 state ${state ?? "not reported"}: ${state === "STOPPED" ? "its volumes" : "the instance and its volumes"}`,
      next:
        instance.isDrill === true
          ? "terminate-recovery-instances"
          : "a recovery instance may be production: decide, do not sweep",
    });
  }
  return lines;
}

/** The DRS API cannot see these. They are listed so that nobody reads "nothing left" too early. */
export const NOT_VISIBLE_HERE = [
  "this chapter's stack: the interface endpoints are billed by the hour until `vp run dr:infra:destroy`",
  "EBS snapshots and volumes created by hand, or left by a job that failed half-way",
  "the chapter 23 instance and the chapter 11 endpoints: they have their own cleanup",
] as const;

export const nothingBilled = (lines: BilledLine[]): boolean =>
  lines.every((line) => line.billed === "no");
// #endregion billed
