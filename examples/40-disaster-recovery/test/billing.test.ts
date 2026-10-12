import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { type DrsApi, drillInstances, protectedServers } from "../src/adapter.ts";
import { nothingBilled, stillBilled } from "../src/billing.ts";
import {
  jobSchema,
  lagSeconds,
  recoveryInstanceSchema,
  recoverySnapshotSchema,
  sourceServerSchema,
} from "../src/drs.ts";
import {
  launchJob,
  recoveryInstances,
  recoverySnapshots,
  SERVER_A,
  SERVER_B,
  sourceServers,
} from "./fixtures.ts";

const servers = v.parse(v.array(sourceServerSchema), sourceServers);
const instances = v.parse(v.array(recoveryInstanceSchema), recoveryInstances);

/** The port, answered from the fixtures. Records what it was asked to change. */
const fake = (): DrsApi & { started: unknown[]; terminated: string[][] } => {
  const started: unknown[] = [];
  const terminated: string[][] = [];
  return {
    started,
    terminated,
    sourceServers: async () => servers,
    recoverySnapshots: async (id) =>
      id === SERVER_A ? v.parse(v.array(recoverySnapshotSchema), recoverySnapshots) : [],
    recoveryInstances: async () => instances,
    job: async () => v.parse(jobSchema, launchJob),
    startRecovery: async (input) => {
      started.push(input);
      return v.parse(jobSchema, launchJob);
    },
    terminateRecoveryInstances: async (ids) => {
      terminated.push(ids);
      return v.parse(jobSchema, { ...launchJob, type: "TERMINATE" });
    },
  };
};

describe("reading the service's answers", () => {
  it("keeps the members this chapter decides on and drops the rest", () => {
    expect(servers[0]).toEqual({
      sourceServerID: SERVER_A,
      lastLaunchResult: "SUCCEEDED",
      dataReplicationInfo: { dataReplicationState: "CONTINUOUS", lagDuration: "PT4S" },
      sourceCloudProperties: { originAvailabilityZone: "ap-northeast-1a" },
    });
  });

  it("refuses a replication state the API reference does not list", () => {
    const odd = {
      sourceServerID: SERVER_A,
      dataReplicationInfo: { dataReplicationState: "HEALTHY" },
    };
    expect(v.safeParse(sourceServerSchema, odd).success).toBe(false);
  });

  it.each([
    ["PT4S", 4],
    ["PT1H2M3S", 3723],
    ["P1DT1S", 86_401],
    ["PT0.5S", 0.5],
  ])("reads the lag %s as %d seconds", (text, seconds) => {
    expect(lagSeconds(text)).toBe(seconds);
  });

  it.each([undefined, "", "4", "00:00:04", "P", "PT", "four seconds"])(
    "reads the lag %s as unknown, never as zero",
    (text) => {
      expect(lagSeconds(text)).toBeNull();
    },
  );

  it("hands the planner only snapshots that were actually taken", async () => {
    const [first, second] = await protectedServers(fake());
    expect(first).toEqual({
      sourceServerID: SERVER_A,
      state: "CONTINUOUS",
      lagSeconds: 4,
      snapshots: [
        { snapshotID: "pit-0000000000000003c", takenAt: "2026-10-13T09:00:04.512000Z" },
        { snapshotID: "pit-0000000000000002b", takenAt: "2026-10-13T08:50:03.100000Z" },
      ],
    });
    expect(second).toMatchObject({ state: "STALLED", lagSeconds: null, snapshots: [] });
  });
});

describe("terminating drill instances", () => {
  it("selects drills that still exist, and never a real recovery", () => {
    expect(drillInstances(instances).map((instance) => instance.recoveryInstanceID)).toEqual([
      "i-0d00000000000000d",
    ]);
  });
});

describe("what is still billed", () => {
  it("lists every replicating server and every instance that exists", () => {
    const lines = stillBilled(servers, instances);
    expect(lines.map(({ resource, billed }) => [resource, billed])).toEqual([
      [SERVER_A, "yes"],
      [SERVER_B, "yes"],
      ["i-0d00000000000000d", "yes"],
      ["i-0e00000000000000e", "yes"],
      ["i-0f00000000000000f", "no"],
    ]);
    expect(nothingBilled(lines)).toBe(false);
  });

  it("says a server with a recovery instance cannot be disconnected yet", () => {
    expect(stillBilled(servers, instances)[0]?.next).toContain(
      "terminate its recovery instance first",
    );
    expect(stillBilled(servers, [])[0]?.next).toBe(
      "disconnect-source-server, then delete-source-server",
    );
  });

  it("tells a drill instance from one that may be production", () => {
    const lines = stillBilled([], instances);
    expect(lines[0]?.next).toBe("terminate-recovery-instances");
    expect(lines[1]?.next).toContain("do not sweep");
  });

  it("keeps a disconnected server on the list until it is deleted", () => {
    const disconnected = v.parse(sourceServerSchema, {
      sourceServerID: SERVER_A,
      dataReplicationInfo: { dataReplicationState: "DISCONNECTED" },
    });
    const [line] = stillBilled([disconnected], []);
    expect(line).toMatchObject({ billed: "winding-down", next: "delete-source-server" });
    expect(nothingBilled([line as NonNullable<typeof line>])).toBe(false);
  });

  it("is clean only when no server and no instance is left", () => {
    expect(nothingBilled(stillBilled([], []))).toBe(true);
  });
});
