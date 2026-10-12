import * as v from "valibot";

import { utcTimestamp } from "@aih/example-04-http-api/src/timestamp.ts";

import type { ReplicationState } from "./drs.ts";

// This file is a model of what the user guide says about launching from a point in time.
// It is not the service: it decides nothing about conversion, capacity, or quotas.

// #region plan
export type ProtectedServer = {
  sourceServerID: string;
  state: ReplicationState | undefined;
  /** How far the staging area is behind the source. null: not reported, or not readable. */
  lagSeconds: number | null;
  /** Point-in-time snapshots that were actually taken, in any order. */
  snapshots: { snapshotID: string; takenAt: string }[];
};

export type DrillRequest = {
  /** "latest": ask for an on-demand snapshot. A date: the newest snapshot at or before it. */
  target: "latest" | Date;
  /** The objective you stated, in seconds. The service does not know this number. */
  rpoSeconds: number;
  now: Date;
};

export type ServerPlan =
  | {
      sourceServerID: string;
      decision: "launch";
      /** Omitted in the request when the on-demand snapshot is asked for. */
      recoverySnapshotID: string | null;
      /** Where the data would stand. null: unknown before the launch. */
      recoveryPointAt: string | null;
      lossSeconds: number | null;
      /** "unknown" is not "yes". A drill that cannot name its loss has not shown the objective is met. */
      withinRpo: "yes" | "no" | "unknown";
      notes: string[];
    }
  | { sourceServerID: string; decision: "blocked"; reason: string };

/** States in which the initial sync has not finished, or replication no longer exists. */
const NOT_RECOVERABLE: Partial<Record<ReplicationState, string>> = {
  INITIATING: "replication is still being set up",
  INITIAL_SYNC: "the initial sync has not completed",
  STOPPED: "replication was stopped, and stopping deletes the snapshots",
  DISCONNECTED: "the server was disconnected from the service",
};

const newestAtOrBefore = (
  snapshots: ProtectedServer["snapshots"],
  limit: Date,
): ProtectedServer["snapshots"][number] | undefined =>
  snapshots
    .filter((snapshot) => new Date(snapshot.takenAt).getTime() <= limit.getTime())
    .toSorted((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime())[0];

const verdict = (lossSeconds: number | null, rpoSeconds: number): "yes" | "no" | "unknown" =>
  lossSeconds === null ? "unknown" : lossSeconds <= rpoSeconds ? "yes" : "no";

export function planServer(server: ProtectedServer, request: DrillRequest): ServerPlan {
  const { sourceServerID } = server;
  if (server.state === undefined) {
    return { sourceServerID, decision: "blocked", reason: "the replication state is not reported" };
  }
  const blocked = NOT_RECOVERABLE[server.state];
  if (blocked !== undefined) {
    return { sourceServerID, decision: "blocked", reason: blocked };
  }

  if (request.target !== "latest") {
    // "Use snapshots created at that timestamp, or slightly before."
    const snapshot = newestAtOrBefore(server.snapshots, request.target);
    if (snapshot === undefined) {
      return {
        sourceServerID,
        decision: "blocked",
        reason: `no snapshot at or before ${request.target.toISOString()}: outside the retention, or before the first one`,
      };
    }
    const lossSeconds = (request.target.getTime() - new Date(snapshot.takenAt).getTime()) / 1000;
    return {
      sourceServerID,
      decision: "launch",
      recoverySnapshotID: snapshot.snapshotID,
      recoveryPointAt: snapshot.takenAt,
      lossSeconds,
      withinRpo: verdict(lossSeconds, request.rpoSeconds),
      notes: [],
    };
  }

  // "Use most recent data" needs the agent to answer. A stalled server is launched from
  // whatever already arrived, and the wait for the on-demand snapshot counts against the RTO.
  const notes: string[] = [];
  if (server.state !== "CONTINUOUS") {
    notes.push(
      `state is ${server.state}: the on-demand snapshot may time out, and an existing snapshot would be faster`,
    );
  }
  if (server.lagSeconds === null) {
    notes.push("lag is not reported: the loss cannot be stated before the launch");
  }
  const recoveryPointAt =
    server.lagSeconds === null
      ? null
      : new Date(request.now.getTime() - server.lagSeconds * 1000).toISOString();
  return {
    sourceServerID,
    decision: "launch",
    recoverySnapshotID: null,
    recoveryPointAt,
    lossSeconds: server.lagSeconds,
    withinRpo: verdict(server.lagSeconds, request.rpoSeconds),
    notes,
  };
}

export type DrillPlan = { servers: ServerPlan[]; meetsObjective: boolean };

export function planDrill(servers: ProtectedServer[], request: DrillRequest): DrillPlan {
  const plans = servers.map((server) => planServer(server, request));
  return {
    servers: plans,
    // One blocked or unknown server is enough: an application recovers whole or not at all.
    meetsObjective:
      plans.length > 0 &&
      plans.every((plan) => plan.decision === "launch" && plan.withinRpo === "yes"),
  };
}
// #endregion plan

// #region request
export type StartRecoveryInput = {
  isDrill: boolean;
  sourceServers: { sourceServerID: string; recoverySnapshotID?: string }[];
  tags: Record<string, string>;
};

/** The StartRecovery request for the servers that can launch. A drill differs by one boolean. */
export function startRecoveryInput(
  plan: DrillPlan,
  options: { isDrill: boolean; name: string },
): StartRecoveryInput {
  const sourceServers = plan.servers.flatMap((server) =>
    server.decision === "launch"
      ? [
          {
            sourceServerID: server.sourceServerID,
            ...(server.recoverySnapshotID === null
              ? {}
              : { recoverySnapshotID: server.recoverySnapshotID }),
          },
        ]
      : [],
  );
  if (sourceServers.length === 0) {
    throw new Error("No server can be launched. Read the plan before starting anything.");
  }
  return {
    isDrill: options.isDrill,
    sourceServers,
    tags: { "aih:drill": options.name, "aih:kind": options.isDrill ? "drill" : "recovery" },
  };
}
// #endregion request

// #region checks
export const CHECKS = [
  { id: "instance-status", what: "EC2 reports both status checks passed" },
  { id: "service-active", what: "systemctl is-active notes.service says active" },
  { id: "api-answers", what: "GET /health on 127.0.0.1:8787 answers 200" },
  { id: "notes-present", what: "GET /notes returns the notes written before the drill" },
  { id: "release-expected", what: "/opt/notes/current points at the release you expect" },
  {
    id: "volume-mounted",
    what: "/var/lib/notes is a mount point, not a directory on the root volume",
  },
] as const;
export type CheckId = (typeof CHECKS)[number]["id"];

export const checkResultSchema = v.object({
  id: v.picklist(CHECKS.map((check) => check.id)),
  outcome: v.picklist(["pass", "fail", "not-run"]),
  detail: v.optional(v.string(), ""),
});
export type CheckResult = v.InferOutput<typeof checkResultSchema>;

export type DrillVerdict = {
  result: "passed" | "failed" | "incomplete";
  failed: CheckId[];
  missing: CheckId[];
};

/** A launched instance proves nothing. Every check has to have run, and to have passed. */
export function evaluateDrill(results: CheckResult[]): DrillVerdict {
  const byId = new Map(results.map((result) => [result.id, result.outcome]));
  const failed = CHECKS.filter((check) => byId.get(check.id) === "fail").map((check) => check.id);
  const missing = CHECKS.filter((check) => {
    const outcome = byId.get(check.id);
    return outcome === undefined || outcome === "not-run";
  }).map((check) => check.id);
  return {
    result: failed.length > 0 ? "failed" : missing.length > 0 ? "incomplete" : "passed",
    failed,
    missing,
  };
}
// #endregion checks

// #region record
const moment = v.nullable(utcTimestamp);

/** What a drill leaves behind. Fields start as null; one that stays null is a step that did not happen. */
export const drillRecordSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1)),
  region: v.pipe(v.string(), v.minLength(1)),
  kind: v.picklist(["drill", "recovery"]),
  objectives: v.object({
    rpoSeconds: v.pipe(v.number(), v.finite(), v.minValue(0)),
    rtoSeconds: v.pipe(v.number(), v.finite(), v.minValue(0)),
  }),
  jobID: v.nullable(v.string()),
  timeline: v.object({
    /** The moment you pretend the source was lost. Loss and recovery time are measured from here. */
    declaredAt: moment,
    startRequestedAt: moment,
    /** pointInTimeSnapshotDateTime of the recovery instance. */
    recoveryPointAt: moment,
    launchedAt: moment,
    verifiedAt: moment,
    terminatedAt: moment,
  }),
  checks: v.array(checkResultSchema),
  notes: v.string(),
});
export type DrillRecord = v.InferOutput<typeof drillRecordSchema>;

export type DrillSummary = {
  /** declaredAt to verifiedAt. Not to launchedAt: a booted instance is not a working service. */
  rtoSeconds: number | null;
  /** declaredAt minus recoveryPointAt. Negative values become 0: the snapshot was newer. */
  rpoSeconds: number | null;
  rto: "met" | "missed" | "not-measured";
  rpo: "met" | "missed" | "not-measured";
  verdict: DrillVerdict;
  /** A drill instance left running is a bill, and a second copy of the app that may wake up. */
  cleanedUp: boolean;
};

const seconds = (from: string | null, to: string | null): number | null =>
  from === null || to === null ? null : (new Date(to).getTime() - new Date(from).getTime()) / 1000;

const against = (measured: number | null, objective: number): "met" | "missed" | "not-measured" =>
  measured === null ? "not-measured" : measured <= objective ? "met" : "missed";

export function summarize(record: DrillRecord): DrillSummary {
  const t = record.timeline;
  const rtoSeconds = seconds(t.declaredAt, t.verifiedAt);
  const behind = seconds(t.recoveryPointAt, t.declaredAt);
  const rpoSeconds = behind === null ? null : Math.max(0, behind);
  return {
    rtoSeconds,
    rpoSeconds,
    rto: against(rtoSeconds, record.objectives.rtoSeconds),
    rpo: against(rpoSeconds, record.objectives.rpoSeconds),
    verdict: evaluateDrill(record.checks),
    cleanedUp: record.kind === "recovery" || t.terminatedAt !== null,
  };
}
// #endregion record
